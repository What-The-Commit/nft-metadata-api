#!/usr/bin/env node
import express from 'express';
import http from 'http';
import https from 'https';
import filesystem from 'fs';
import cors from 'cors';
import env from 'dotenv';
import awaitjs from '@awaitjs/express';
import models, {connectDb} from './models/index.js';
import ethers from 'ethers';
import apicache from 'apicache'
import crypto from 'crypto';
import OpenseaApi from "./api/opensea/opensea-api.js";
import EthersCommon from "./api/ethers/common.js";
import compression from "compression";

env.config();

const openseaApi = new OpenseaApi(ethers.utils, 0, process.env.OPENSEA_API_KEY);
const ethersCommon = new EthersCommon(process.env.ETHERS_PROVIDER);

const privateKey = filesystem.readFileSync(process.env.SSL_PRIVATE_KEY);
const certificate = filesystem.readFileSync(process.env.SSL_CERT);

const credentials = {key: privateKey, cert: certificate};

const app = awaitjs.addAsync(express());

apicache.options({
    headerBlacklist:  ['access-control-allow-origin'],
    appendKey: function(request, response) {
        return crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
    }
});

const cache = apicache.middleware;
const onlyStatus200 = (req, res) => res.statusCode === 200;

let corsWhitelist = process.env.CORS_ORIGINS.split(' ');

corsWhitelist.push('https://localhost:' + process.env.HTTPS_PORT);
corsWhitelist.push('https://127.0.0.1:' + process.env.HTTPS_PORT);

app.use(cors({
    origin: corsWhitelist
}));

app.use(express.json());

const shouldCompress = (req, res) => {
    if (req.headers['x-no-compression']) {
        // don't compress responses if this request header is present
        return false;
    }

    // fallback to standard compression
    return compression.filter(req, res);
};

app.use(compression({
    // filter decides if the response should be compressed or not,
    // based on the `shouldCompress` function above
    filter: shouldCompress,
    // threshold is the byte threshold for the response body size
    // before compression is considered, the default is 1kb
    threshold: 0
}));

app.use(function (request, response, next) {
    if (!request.secure) {
        return response.redirect("https://" + request.headers.host.replace(process.env.HTTP_PORT, process.env.HTTPS_PORT) + request.url);
    }

    next();
})

app.options('*', cors());

app.getAsync('/nft/:contractAddress', cache('5 minutes', onlyStatus200), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    response.send(await models.Asset.paginate({contract: contractAddress}));
});

app.postAsync('/nft/:contractAddress/distinct/:value', cache('24 hours', onlyStatus200), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    if (request.body.hasOwnProperty('filters') && request.params.value.indexOf('traits.value') !== -1 && request.body.filters[0].key === 'traits.type') {
        const aggregation = [
            {
                '$match': {
                    'contract': contractAddress
                }
            }, {
                '$project': {
                    'traits': {
                        '$filter': {
                            'input': '$traits',
                            'as': 'trait',
                            'cond': {
                                '$eq': [
                                    '$$trait.type', request.body.filters[0].value
                                ]
                            }
                        }
                    }
                }
            }, {
                '$unwind': {
                    'path': '$traits'
                }
            }, {
                '$group': {
                    '_id': '$traits.type',
                    'distinctTraits': {
                        '$addToSet': '$traits.value'
                    }
                }
            }
        ];

        response.send(await models.Asset.aggregate(aggregation));
    }

    response.send(await models.Asset.distinct(request.params.value, {contract: contractAddress}).exec());
});

/**
 * @example
 * {
 *     "filters": [
 *         {"key": "traits.type", "value": "Origin"},
 *         {"key": "traits.value", "value": "neptune"}
 *     ]
 * }
 */
app.postAsync('/nft/:contractAddress/lowest-price', cache('1 hour', onlyStatus200), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    if (await models.Order.exists({contract: contractAddress}) === false) {
        let tokenId = null;

        if (request.body.hasOwnProperty('filters') && request.body.filters[0] !== undefined && request.body.filters[0].key === 'tokenId') {
            tokenId = request.body.filters[0].value;
        }

        let lowestPrice;

        try {
            lowestPrice = await openseaApi.getLowestPriceOfAssetByContractAndId(contractAddress, tokenId);
        } catch (e) {
            console.error(e);
            response.status(e.response.status);
            response.send(e.message);
        }

        response.send([{
            order: {
                price: {
                    '$numberDecimal': lowestPrice
                }
            }
        }]);
    }

    let match = {
        'contract': contractAddress,
    };

    if (request.body.hasOwnProperty('filters')) {
        request.body.filters.forEach(function (filter) {
            match[filter.key] = filter.value;
        })
    }

    let aggregation = [
        {
            '$match': match
        },    {
            '$lookup': {
                'from': 'orders',
                'let': {
                    'assetContract': '$contract',
                    'assetTokenId': '$tokenId'
                },
                'pipeline': [
                    {
                        '$match': {
                            '$expr': {
                                '$and': [
                                    {
                                        '$eq': [
                                            '$contract', '$$assetContract'
                                        ]
                                    }, {
                                        '$eq': [
                                            '$tokenId', '$$assetTokenId'
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                ],
                'as': 'orders'
            }
        }, {
            '$match': {
                '$expr': {
                    '$gt': [
                        {
                            '$size': '$orders'
                        }, 0
                    ]
                }
            }
        }, {
            '$sort': {
                'orders.price': 1
            }
        }, {
            '$limit': 1
        }, {
            '$project': {
                'order': {
                    '$first': '$orders'
                }
            }
        }
    ];

    const lowestPriceAggregation = await models.Asset.aggregate(aggregation);

    response.send(lowestPriceAggregation);
});

/**
 * @example
 * {
 *     "filters": [
 *         {"key": "traits.type", "value": "Origin"},
 *         {"key": "traits.value", "value": "neptune"}
 *     ]
 * }
 */
app.postAsync('/nft/:contractAddress/token-ids', cache('1 hour', onlyStatus200), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    let match = {
        'contract': contractAddress,
    };

    if (request.body.hasOwnProperty('filters')) {
        request.body.filters.forEach(function (filter) {
            match[filter.key] = filter.value;
        })
    }

    const tokenIdAggregation = await models.Asset.aggregate([
        {
            '$match': match
        },
        {
            '$project': {
                'tokenId': 1,
                'contract': 1,
                '_id': 0
            }
        },
        {
            '$group': {
                '_id': {
                    'contract': '$contract'
                },
                'hits': {
                    '$count': {}
                },
                'tokenId': {
                    '$push': {
                        'tokenId': '$tokenId'
                    }
                },
            }
        }
    ]);

    response.send(tokenIdAggregation);
});

app.getAsync('/ens/resolve/:name', cache('7 days', onlyStatus200), async function (req, res, next) {
    const provider = new ethers.providers.JsonRpcProvider(process.env.ETHERS_PROVIDER);

    res.send(await provider.resolveName(req.params.name));
});

app.postAsync('/nft/:contractAddress/total-supply', cache('24 hours', onlyStatus200), async function (request, response, next) {
    let tokenId = null;
    let type;

    if (request.body.hasOwnProperty('type')) {
        type = request.body.type;
    }

    if (type === undefined) {
        response.status(400);
        response.send('Please provide type with either ERC721 or ERC1155 in body');
        return;
    }

    if (request.body.hasOwnProperty('filters') && request.body.filters[0] !== undefined && request.body.filters[0].key === 'tokenId') {
        if (type === 'ERC721') {
            response.status(400);
            response.send('ERC721 cannot have tokenId');
            return;
        }

        tokenId = request.body.filters[0].value;
    }

    const totalSupply = await ethersCommon.getTotalSupplyByContractAddressAndType(request.params.contractAddress, type, tokenId);

    response.send(totalSupply.toString());
});

app.getAsync('/', cache('24 hours', onlyStatus200), async function (req, res, next) {
    res.send('not what you\'re looking');
});

// Because of `getAsync()`, this error handling middleware will run.
// `addAsync()` also enables async error handling middleware.
app.use(function (error, req, res, next) {
    res.send(error.message);
});

let httpServer = http.createServer(app);
let httpsServer = https.createServer(credentials, app);

httpsServer.timeout = 0;

connectDb().then(async function () {
    httpServer.listen(process.env.HTTP_PORT);
    httpsServer.listen(process.env.HTTPS_PORT);
});
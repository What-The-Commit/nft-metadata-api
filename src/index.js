import express from 'express';
import http from 'http';
import https from 'https';
import filesystem from 'fs';
import cors from 'cors';
import env from 'dotenv';
import awaitjs from '@awaitjs/express';
import models, {connectDb} from './models/index.js';
import ethers from 'ethers';
import IndexContract from "./indexing/indexContract.js";
import apicache from 'apicache'

env.config();

const privateKey = filesystem.readFileSync(process.env.SSL_PRIVATE_KEY);
const certificate = filesystem.readFileSync(process.env.SSL_CERT);

const credentials = {key: privateKey, cert: certificate};

const indexContract = new IndexContract(process.env.ETHERS_PROVIDER);

const app = awaitjs.addAsync(express());

apicache.options({
    appendKey: function(request, response) {
        if (request.url.indexOf('lowest-price') !== -1) {
            return '';
        }

        return btoa(JSON.stringify(request.body));
    }
});

const cache = apicache.middleware

let corsWhitelist = process.env.CORS_ORIGINS.split(' ');

corsWhitelist.push('https://localhost:' + process.env.HTTPS_PORT);
corsWhitelist.push('https://127.0.0.1:' + process.env.HTTPS_PORT);

app.use(cors({
    origin: corsWhitelist
}));

app.use(express.json())

app.use(function (request, response, next) {
    if (!request.secure) {
        return response.redirect("https://" + request.headers.host.replace(process.env.HTTP_PORT, process.env.HTTPS_PORT) + request.url);
    }

    next();
})

app.options('*', cors());

app.getAsync('/nft/:contractAddress', cache('5 minutes'), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    response.send(await models.Asset.paginate({contract: contractAddress}));
});

app.getAsync('/nft/:contractAddress/index', cache('24 hours'), async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    try {
        await indexContract.index(contractAddress);
    } catch (error) {
        console.error(contractAddress, error);
        response.send('An error occurred: ' + JSON.stringify(error));
    }

    response.redirect(request.href.replace('/index', ''));
});

app.postAsync('/nft/:contractAddress/distinct/:value', cache('24 hours'), async function (request, response, next) {
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
app.postAsync('/nft/:contractAddress/lowest-price', cache('1 hour'), async function (request, response, next) {
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

    let aggregation = [
        {
            '$match': match
        }, {
            '$lookup': {
                'from': 'orders',
                'localField': 'tokenId',
                'foreignField': 'tokenId',
                'as': 'orders'
            }
        }, {
            '$project': {
                'order': {
                    '$first': '$orders'
                },
                'orderCount': {
                    '$cond': {
                        'if': {
                            '$isArray': '$orders'
                        },
                        'then': {
                            '$size': '$orders'
                        },
                        'else': 0
                    }
                }
            }
        }, {
            '$match': {
                'orderCount': {
                    '$gt': 0
                }
            }
        }, {
            '$sort': {
                'order.price': 1
            }
        }, {
            '$limit': 1
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
app.postAsync('/nft/:contractAddress/token-ids', cache('1 hour'), async function (request, response, next) {
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

    console.log(request.body);

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

// `getAsync()` is like `app.get()`, but supports async functions
app.getAsync('/', cache('24 hours'), async function (req, res, next) {
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
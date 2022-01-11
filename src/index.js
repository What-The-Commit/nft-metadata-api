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

env.config();

const privateKey = filesystem.readFileSync(process.env.SSL_PRIVATE_KEY);
const certificate = filesystem.readFileSync(process.env.SSL_CERT);

const credentials = {key: privateKey, cert: certificate};

const indexContract = new IndexContract(process.env.ETHERS_PROVIDER);

const app = awaitjs.addAsync(express());

let corsWhitelist = process.env.CORS_ORIGINS.split(' ');

corsWhitelist.push('https://localhost:' + process.env.HTTPS_PORT);
corsWhitelist.push('https://127.0.0.1:' + process.env.HTTPS_PORT);

app.use(cors({
    origin: corsWhitelist
}));

app.use(express.json())

app.use(function(request, response, next) {
    if (!request.secure) {
        return response.redirect("https://" + request.headers.host.replace(process.env.HTTP_PORT, process.env.HTTPS_PORT) + request.url);
    }

    next();
})

app.options('*', cors());

app.getAsync('/nft/:contractAddress', async function (request, response, next) {
    let contractAddress;

    try {
        contractAddress = ethers.utils.getAddress(request.params.contractAddress);
    } catch (e) {
        response.send('Invalid contract address');
    }

    if (parseInt(request.query.index) === 1) {
        await indexContract.index(contractAddress);
    }

    response.send(await models.Asset.paginate({contract: contractAddress}));
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
app.postAsync('/nft/:contractAddress/lowest-price', async function (request, response, next) {
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
app.postAsync('/nft/:contractAddress/token-ids', async function (request, response, next) {
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
app.getAsync('/', async function (req, res, next) {
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
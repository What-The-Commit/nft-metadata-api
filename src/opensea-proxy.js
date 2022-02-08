#!/usr/bin/env node
import express from 'express';
import http from 'http';
import https from 'https';
import filesystem from 'fs';
import cors from 'cors';
import env from 'dotenv';
import awaitjs from '@awaitjs/express';
import apicache from 'apicache'
import crypto from 'crypto';
import OpenseaApi from "./api/opensea/opensea-api.js";
import ethers from "ethers";
import compression from 'compression';

env.config();

const openseaApi = new OpenseaApi(ethers.utils, 0, process.env.OPENSEA_API_KEY);

const privateKey = filesystem.readFileSync(process.env.OS_SSL_PRIVATE_KEY);
const certificate = filesystem.readFileSync(process.env.OS_SSL_CERT);

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

corsWhitelist.push('https://localhost:' + process.env.OS_HTTPS_PORT);
corsWhitelist.push('https://127.0.0.1:' + process.env.OS_HTTPS_PORT);

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
        return response.redirect("https://" + request.headers.host.replace(process.env.OS_HTTP_PORT, process.env.OS_HTTPS_PORT) + request.url);
    }

    next();
})

app.options('*', cors());

app.getAsync('*', cache('24 hours', onlyStatus200), async function (req, res, next) {
    let response;

    try {
        response = await openseaApi._doFetch(req.originalUrl.substring(1));
    } catch (e) {
        console.error(e);
        res.status(e.response.status);
        res.send(e.message);
        return;
    }

    const responseData = await response.json();

    if (responseData.detail !== undefined && responseData.detail.indexOf('throttled') !== -1) {
        res.status(429);
        res.send(responseData.detail);
        return;
    }

    res.send(responseData);
});

app.postAsync('*', cache('24 hours', onlyStatus200), async function (req, res, next) {
    res.status(429);
    res.send('Not implemented');
});

app.putAsync('*', cache('24 hours', onlyStatus200), async function (req, res, next) {
    res.status(429);
    res.send('Not implemented');
});

// Because of `getAsync()`, this error handling middleware will run.
// `addAsync()` also enables async error handling middleware.
app.use(function (error, req, res, next) {
    res.send(error.message);
});

let httpServer = http.createServer(app);
let httpsServer = https.createServer(credentials, app);

httpsServer.timeout = 0;

httpServer.listen(process.env.OS_HTTP_PORT);
httpsServer.listen(process.env.OS_HTTPS_PORT);
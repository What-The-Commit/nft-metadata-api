import {utils} from 'ethers';
import env from 'dotenv';
import models, {connectDb} from './models/index.js';
import IndexOrders from './indexing/indexOrders.js';
import Logger from "./logger/logger.js";
import {compileTrust} from "express/lib/utils.js";

env.config();

connectDb().then(async function () {
    const logger = new Logger(console, process.env.NODE_ENV);

    let contracts = process.argv[2];

    if (contracts !== undefined) {
        contracts = contracts.split(',');
    }

    if (contracts === undefined) {
        contracts = await models.Asset.distinct('contract').exec();
    }

    const indexOrders = new IndexOrders(process.env.OPENSEA_RATELIMIT_MIN, process.env.ETHERS_PROVIDER, logger);

    for (const contract of contracts) {
        let contractAddress;

        try {
            contractAddress = utils.getAddress(contract);
        } catch (e) {
            console.error({message: 'Invalid contract address', contract: contract});
            continue;
        }

        try {
            await indexOrders.indexOrders(contractAddress);
        } catch (error) {
            console.error(contractAddress, error);
            continue;
        }
    }

    process.exit();
});
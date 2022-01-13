import ethers from 'ethers';
import env from 'dotenv';
import {connectDb} from './models/index.js';
import IndexContract from "./indexing/indexContract.js";

env.config();

function log(log, logLevel) {
    if (process.env.NODE_ENV === 'production' && logLevel !== 'debug') {
        console.log(log);
        return;
    }

    if (process.env.NODE_ENV === 'development') {
        if (logLevel === 'debug') {
            console.debug(log);
            return;
        }

        if (logLevel !== 'debug') {
            console.log(log);
        }
    }
}

connectDb().then(async function () {
    const indexContract = new IndexContract(process.env.ETHERS_PROVIDER);

    let contractAddress = process.argv[2];

    try {
        contractAddress = ethers.utils.getAddress(contractAddress);
    } catch (e) {
        console.error({message: 'Invalid contract address', contract: contractAddress});
        process.exit();
    }

    try {
        await indexContract.index(contractAddress);
    } catch (error) {
        console.error(contractAddress, error);
        process.exit();
    }

    process.exit();
});
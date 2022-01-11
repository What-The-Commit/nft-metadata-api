import {RateLimit} from "async-sema";
import fetch from 'node-fetch';
import ethers from 'ethers';
import env from 'dotenv';
import lodash from 'lodash';
import models, {connectDb} from './models/index.js';

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
    const ethersProvider = new ethers.providers.JsonRpcProvider(process.env.ETHERS_PROVIDER);

    let contractAddress = process.argv[2];

    try {
        contractAddress = ethers.utils.getAddress(contractAddress);
    } catch (e) {
        console.error({message: 'Invalid contract address', contract: contractAddress});
        process.exit();
    }

    const contract = new ethers.Contract(
        contractAddress,
        [
            'function totalSupply() external view returns (uint256)',
            'function ownerOf(uint256 tokenId) external view returns (address owner)',
        ],
        ethersProvider
    );

    const totalSupply = await contract.totalSupply();

    let startingTokenId = 0;

    try {
        await contract.ownerOf(startingTokenId);
    } catch (e) {
        try {
            startingTokenId += 1;
            await contract.ownerOf(startingTokenId);
        } catch (error) {
            console.error('Could not determine starting token id');
            process.exit();
        }
    }

    log('Starting at ' + startingTokenId + ' Total supply: ' + totalSupply, 'debug');

    let tokenIds = [];

    for (let i = startingTokenId; i < totalSupply; i++) {
        tokenIds.push(i);
    }

    const chunks = 30;

    let calls = [];

    const rateLimit = RateLimit(process.env.OPENSEA_RATELIMIT_MIN, {timeUnit: 60000, uniformDistribution: true});

    for (const chunksOfTokenIds of lodash.chunk(tokenIds, chunks)) {
        const options = {
            method: 'GET',
            headers: {Accept: 'application/json', 'X-API-KEY': process.env.OPENSEA_API_KEY}
        };

        let params = new URLSearchParams({
            asset_contract_address: contractAddress,
            bundled: false,
            include_bundled: false,
            sale_kind: 0,
            side: 1,
            order_by: 'eth_price',
            order_direction: 'asc',
            offset: 0,
            limit: chunks
        });

        for (const tokenId of chunksOfTokenIds) {
            params.append('token_ids', tokenId)
        }

        await rateLimit();

        log('Orders from: ' + 'https://api.opensea.io/wyvern/v1/orders?'+params.toString(), 'debug');

        let call = fetch('https://api.opensea.io/wyvern/v1/orders?'+params.toString(), options);

        calls.push(call);

        call
            .then(async function (orderResponse) {
                if (orderResponse.status === 429) {
                    console.error('Opensea is rate limiting, wait a minute and try again with a lower RATELIMIT_MIN setting');
                    process.exit();
                }

                let orderData = await orderResponse.json();

                if (orderData.orders.length === 0) {
                    return;
                }

                for (const order of orderData.orders) {
                    log('Order found for ' + order.asset.name, 'debug');

                    let existsOrder = await models.Order.exists({
                        contract: order.asset.asset_contract.address,
                        tokenId: order.asset.token_id,
                        type: 'opensea'
                    });

                    let isNewerOrder = await models.Order.exists({
                        contract: order.asset.asset_contract.address,
                        tokenId: order.asset.token_id,
                        type: 'opensea',
                        createdDate: { $gt: order.created_date }
                    });

                    if (isNewerOrder) {
                        await models.Order.updateFromOpenseaOrder(order);
                    }

                    if (!isNewerOrder && !existsOrder) {
                        await models.Order.createFromOpenseaOrder(order);
                    }
                }
            })
            .catch(error => console.error(error))
        ;
    }

    await Promise.allSettled(calls).then(function () {
        log('All orders imported for ' + contractAddress, 'info');
        process.exit();
    });
});
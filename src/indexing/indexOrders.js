import ethers from "ethers";
import {RateLimit} from "async-sema";
import lodash from "lodash";
import fetch from "node-fetch";
import models from "../models/index.js";

class IndexOrders {
    constructor(
        rateLimitMin,
        ethersProvider,
        logger,
        abi = [
            'function totalSupply() external view returns (uint256)',
            'function ownerOf(uint256 tokenId) external view returns (address owner)',
        ]
    ) {
        this.rateLimitMin = rateLimitMin;
        this.ethersProvider = new ethers.providers.JsonRpcProvider(ethersProvider);
        this.log = logger;
        this.abi = abi;
    }

    async indexOrders(contractAddress, chunks = 30) {
        const contract = new ethers.Contract(
            contractAddress,
            this.abi,
            this.ethersProvider
        );

        let totalSupply;

        try {
            totalSupply = await contract.totalSupply();
        } catch (e) {
            this.log.error('Could not determine total supply', contractAddress);
            throw {message: 'Could not determine total supply', context: contractAddress};
        }

        let startingTokenId = 0;

        try {
            await contract.ownerOf(startingTokenId);
        } catch (e) {
            try {
                startingTokenId += 1;
                await contract.ownerOf(startingTokenId);
            } catch (error) {
                this.log.error('Could not determine starting token id', contractAddress);
                throw {message: 'Could not determine starting token id', context: contractAddress};
            }
        }

        this.log.debug('Starting at ' + startingTokenId + ' Total supply: ' + totalSupply);

        let tokenIds = [];

        for (let i = startingTokenId; i < totalSupply; i++) {
            tokenIds.push(i);
        }

        let calls = [];

        const rateLimit = RateLimit(this.rateLimitMin, {timeUnit: 60000, uniformDistribution: true});

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

            this.log.debug('Orders from: ' + 'https://api.opensea.io/wyvern/v1/orders?'+params.toString(), contractAddress);

            let call = fetch('https://api.opensea.io/wyvern/v1/orders?'+params.toString(), options);

            calls.push(call);

            call
                .then(async function (orderResponse) {
                    if (orderResponse.status === 429) {
                        this.log.error('Opensea is rate limiting, wait a minute and try again with a lower RATELIMIT_MIN setting');
                        throw {message: 'Opensea is rate limiting, wait a minute and try again with a lower RATELIMIT_MIN setting', context: orderResponse};
                    }

                    let orderData = await orderResponse.json();

                    if (orderData.orders.length === 0) {
                        return;
                    }

                    for (const order of orderData.orders) {
                        this.log.debug('Order found for ' + order.asset.name);

                        let existsOrder = await models.Order.exists({
                            contract: contractAddress,
                            tokenId: order.asset.token_id,
                            type: 'opensea'
                        });

                        let isNewerOrder = await models.Order.exists({
                            contract: contractAddress,
                            tokenId: order.asset.token_id,
                            type: 'opensea',
                            createdDate: { $gt: order.created_date }
                        });

                        if (isNewerOrder) {
                            await models.Order.updateFromOpenseaOrder(contractAddress, order);
                        }

                        if (!isNewerOrder && !existsOrder) {
                            await models.Order.createFromOpenseaOrder(contractAddress, order);
                        }
                    }
                }.bind(this))
                .catch(function (error) {
                    this.log.error(error);
                }.bind(this))
            ;
        }

        await Promise.allSettled(calls).then(function () {
            this.log.info('All orders imported for ' + contractAddress);
        }.bind(this));
    }
}

export default IndexOrders;
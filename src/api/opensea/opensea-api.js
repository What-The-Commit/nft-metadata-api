import fetch from "node-fetch";

class OpenseaApi {
    constructor(etherUtils, ethPriceInUsd, apiKey = null, maxPercentagePriceDrop = 0.9, baseUrl = 'https://api.opensea.io/api/v1/') {
        this.etherUtils = etherUtils;    
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.ethPriceInUsd = ethPriceInUsd;

        this.erc721Identifier = 'non-fungible';
        this.erc1155Identifier = 'semi-fungible';

        this.maxPercentagePriceDrop = maxPercentagePriceDrop;
    }

    async _doFetch(queryString, config = null) {
        if (config === null) {
            config = { method: 'GET'};
        }

        if (this.apiKey !== null) {
            config['headers'] = {'X-API-KEY': this.apiKey}
        }

        return await fetch(this.baseUrl + queryString, config);
    }

    convertUsdToEth(_usdValue, decimals) {
        let usdValue = _usdValue.slice(0, _usdValue.length - decimals) + "," + _usdValue.slice(_usdValue.length - decimals);
    
        return (parseFloat(usdValue) / this.ethPriceInUsd);
    }

    async getAssetsForOwnerByContract(owner, contract) {
        let response = await this._doFetch('assets?owner='+owner+'&asset_contract_address='+contract+'&order_direction=desc&offset=0&limit=50');
    
        return await response.json();
    }

    async getLowestPriceOfAssetByContractAndId(contract, id = null) {  
        let params = new URLSearchParams({
            asset_contract_address: contract,
            order_by: 'sale_date',
            order_direction: 'desc',
            offset: 0,
            limit: id !== null ? 1 : 20
        });
    
        if (id !== null) {
            params.append('token_ids', id);
        }
    
        let response = await this._doFetch('assets?' + params.toString());

        if (response.status !== 200) {
            let error = new Error('Opensea request failed');
            error.response = response;

            throw error;
        }

        let data = await response.json();
    
        if (data.assets.length === 0) {
            return 0.00;
        }
    
        let lowestPrice = 0;
    
        data.assets.forEach(function (asset) {
            let assetPrice;
    
            if (asset.asset_contract.asset_contract_type === this.erc721Identifier && asset.last_sale.payment_token.symbol.indexOf('WETH') !== -1) {
                return
            }
     
            if (asset.last_sale.payment_token.symbol.indexOf('USD') !== -1) {
                let convertedEth = this.convertUsdToEth(asset.last_sale.total_price, asset.last_sale.payment_token.decimals);
        
                assetPrice = convertedEth / parseInt(asset.last_sale.quantity);
    
                if (lowestPrice === 0 || assetPrice < lowestPrice || (lowestPrice - assetPrice) / lowestPrice <= this.maxPercentagePriceDrop) {
                    lowestPrice = assetPrice;
                }
    
                return;
            }
        
            assetPrice = parseFloat(this.etherUtils.formatEther(asset.last_sale.total_price))  / parseInt(asset.last_sale.quantity);
                        
            if (lowestPrice === 0 || assetPrice < lowestPrice || (lowestPrice - assetPrice) / lowestPrice <= this.maxPercentagePriceDrop ) {
                lowestPrice = assetPrice;
            }
      
        }.bind(this));
    
        return lowestPrice;
    }

    async getCollectionsByOwner(ownerAddress) {
        let response = await this._doFetch('collections?asset_owner=' + ownerAddress + '&offset=0&limit=300');
    
        return await response.json();
    }
    
    async getFloorPriceForCollectionBySlug(slug) {
        let response = await this._doFetch('collection/' + slug + '/stats');
    
        let data = await response.json();
    
        return data.stats.floor_price;
    }
}

export default OpenseaApi;
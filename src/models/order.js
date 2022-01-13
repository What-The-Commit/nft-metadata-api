import mongoose from "mongoose";
import mongoosePaginate from 'mongoose-paginate-v2';
import {utils} from "ethers";

const schema = new mongoose.Schema(
    {
        name: {
            type: String,
            unique: false,
            required: true,
        },
        contract: {
            type: String,
            unique: false,
            required: true,
        },
        tokenId: {
            type: Number,
            required: true,
        },
        type: {
            type: String,
            required: true
        },
        createdDate: {
            type: Date,
            required: true
        },
        lastUpdated: {
            type: Date,
            default: Date.now,
            required: true
        },
        price: {
            type: mongoose.Types.Decimal128,
            required: true
        },
        side: {
            type: Number,
            required: true
        },
        saleKind: {
            type: Number,
            required: false
        }
    },
    { timestamps: true },
);

schema.index({contract: 1, tokenId: 1, type: 1}, { unique: true });

schema.plugin(mongoosePaginate);

const Order = mongoose.model('Order', schema);

Order.createFromOpenseaOrder = function (contractAddress, OpenseaOrder) {
    return this.create({
        name: OpenseaOrder.asset.name,
        contract: contractAddress,
        tokenId: OpenseaOrder.asset.token_id,
        type: 'opensea',
        createdDate: OpenseaOrder.created_date,
        closingDate: OpenseaOrder.closing_date,
        price: utils.formatEther(utils.parseUnits(OpenseaOrder.current_price, 'wei')),
        side: OpenseaOrder.side,
        saleKind: OpenseaOrder.sale_kind
    });
};

Order.updateFromOpenseaOrder = function (contractAddress, OpenseaOrder) {
    return this.updateOne(
        {
            contract: OpenseaOrder.asset.asset_contract.address,
            tokenId: OpenseaOrder.asset.token_id,
            type: 'opensea',
            createdDate: { $gt: OpenseaOrder.created_date }
        },
        {
            createdDate: OpenseaOrder.created_date,
            closingDate: OpenseaOrder.closing_date,
            price: utils.formatEther(utils.parseUnits(OpenseaOrder.current_price, 'wei'))
        }
    );
};

export default Order;
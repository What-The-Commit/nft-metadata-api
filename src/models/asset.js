import mongoose from "mongoose";
import mongoosePaginate from 'mongoose-paginate-v2';

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
        image: {
            type: String
        },
        traits: [{
            type: { type: String },
            value: String
        }]
    },
    { timestamps: true },
);

schema.index({"traits.type": 1, "traits.value": 1});
schema.index({contract: 1, tokenId: 1}, { unique: true });

schema.plugin(mongoosePaginate);

const Asset = mongoose.model('Asset', schema);

Asset.createFromContractByMetadata = function (contractAddress, Metadata) {
    let traits = [];

    Metadata.attributes.forEach(function (attribute) {
        traits.push({
            type: attribute.trait_type,
            value: attribute.value,
        });
    })

    return this.create({name: Metadata.name, tokenId: Metadata.tokenId, image: Metadata.image, contract: contractAddress, traits: traits});
};

export default Asset;
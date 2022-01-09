import mongoose from 'mongoose';

import Asset from './asset.js';

const connectDb = function () {
    return mongoose.connect(process.env.DATABASE_URL);
};

const models = { Asset };

export { connectDb };

export default models;
import mongoose from 'mongoose';

import Asset from './asset.js';
import Order from './order.js';

const connectDb = function () {
    return mongoose.connect(process.env.DATABASE_URL);
};

const models = { Asset, Order };

export { connectDb };

export default models;
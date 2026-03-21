const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ Connected to MongoDB');
}

const staffSchema = new mongoose.Schema({
    _id: String,
    rank: String,
    strikes: [{
        reason: String,
        date: String,
        addedBy: { id: String, username: String },
        removed: Boolean,
        removedBy: String,
        removedReason: String,
        removedAt: String
    }],
    terminations: [{
        reason: String,
        date: String,
        addedBy: { id: String, username: String },
        proof: String,
        removed: Boolean,
        removedBy: String,
        removedReason: String,
        removedAt: String
    }],
    blacklists: [{
        reason: String,
        date: String,
        addedBy: { id: String, username: String },
        removed: Boolean,
        removedBy: String,
        removedReason: String,
        removedAt: String
    }]
}, { versionKey: false });

const StaffRecord = mongoose.model('StaffRecord', staffSchema);

module.exports = { connectDB, StaffRecord };
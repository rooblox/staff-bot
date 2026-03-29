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
    }],
    notes: [{
        note: String,
        date: String,
        addedBy: { id: String, username: String }
    }]
}, { versionKey: false });

const reminderSchema = new mongoose.Schema({
    userId: String,
    message: String,
    fireAt: Date,
    createdAt: Date,
    createdBy: String,
    recurring: String,
    recurringMs: Number
}, { versionKey: false });

const sessionSchema = new mongoose.Schema({
    hostId: String,
    coHostId: String,
    shiftType: String,
    time: String,
    announcementMessageId: String,
    announcementChannelId: String,
    requestMessageId: String,
    requestChannelId: String,
    status: String, // pending, approved, cancelled, finished
    preSessionReminderSent: Boolean,
    sessionStarted: Boolean,
    finishCheckStarted: Boolean,
    createdAt: Date,
    approvedAt: Date,
    sessionFireAt: Date,
    autoDeleteAt: Date
}, { versionKey: false });

const StaffRecord = mongoose.model('StaffRecord', staffSchema);
const Reminder = mongoose.model('Reminder', reminderSchema);
const Session = mongoose.model('Session', sessionSchema);

module.exports = { connectDB, StaffRecord, Reminder, Session };
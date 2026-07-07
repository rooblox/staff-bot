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
        department: String,
        addedBy: { id: String, username: String },
        removed: Boolean,
        removedBy: String,
        removedReason: String,
        removedAt: String
    }],
    terminations: [{
        reason: String,
        date: String,
        department: String,
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
        department: String,
        addedBy: { id: String, username: String },
        removed: Boolean,
        removedBy: String,
        removedReason: String,
        removedAt: String
    }],
    notes: [{
        note: String,
        date: String,
        department: String,
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
    status: String,
    preSessionReminderSent: Boolean,
    sessionStarted: Boolean,
    finishCheckStarted: Boolean,
    hostConfirmed: Boolean,
    createdAt: Date,
    approvedAt: Date,
    sessionFireAt: Date,
    autoDeleteAt: Date
}, { versionKey: false });

const loaSchema = new mongoose.Schema({
    userId: String,
    username: String,
    department: String,
    reason: String,
    timeGone: String,
    returnDate: String,
    returnDateParsed: Date,
    status: String,
    messageId: String,
    channelId: String,
    logChannelId: String,
    createdAt: Date,
    approvedAt: Date,
    returnReminderSent: Boolean,
    autoDeleteAt: Date
}, { versionKey: false });

const completedTrainingsSchema = new mongoose.Schema({
    _id: String,
    completedTrainings: [String]
}, { versionKey: false });

const ticketSchema = new mongoose.Schema({
    caseId: String,
    userId: String,
    category: String,
    serverId: String,
    channelId: String,
    ticketCategoryId: String,
    claimedBy: String,
    claimedByTag: String,
    status: String,
    openReason: String,
    pingRoleId: String,
    pingRoleIds: [String],
    logChannelId: String,
    repingTimeout: String,
    createdAt: Date,
    claimedAt: Date,
    closedAt: Date
}, { versionKey: false });

const reviewSchema = new mongoose.Schema({
    staffId: String,
    staffTag: String,
    reviewerId: String,
    reviewerTag: String,
    rating: Number,
    ticketCaseId: String,
    serverId: String,
    createdAt: Date
}, { versionKey: false });

const ticketPanelSchema = new mongoose.Schema({
    serverId: String,
    channelId: String,
    logChannelId: String,
    messageId: String,
    title: String,
    description: String,
    categories: [{
        name: String,
        pingRoleId: String,
        pingRoleIds: [String],
        emoji: String,
        description: String
    }],
    ticketCategoryId: String,
    createdAt: Date
}, { versionKey: false });

const birthdaySchema = new mongoose.Schema({
    _id: String,
    month: Number,
    day: Number,
    lastAnnouncedYear: Number
}, { versionKey: false });

const paymentSchema = new mongoose.Schema({
    offeredBy: String,
    offeredByTag: String,
    targetId: String,
    targetTag: String,
    targetDiscriminator: String,
    targetCreatedAt: Date,
    amount: Number,
    currency: String,
    description: String,
    serverId: String,
    serverName: String,
    department: String,
    logChannelId: String,
    status: String,
    counterAmount: Number,
    agreementSigned: Boolean,
    agreementSignedAt: Date,
    paid: Boolean,
    paidAt: Date,
    paidBy: String,
    paidByTag: String,
    createdAt: Date,
    history: [{
        action: String,
        by: String,
        byTag: String,
        amount: Number,
        at: Date,
        note: String
    }]
}, { versionKey: false });
const checklistSchema = new mongoose.Schema({
    _id: String,
    scope: String,
    serverId: String,
    ownerId: String,
    items: [{
        text: String,
        done: Boolean,
        addedBy: String
    }]
}, { versionKey: false });

const StaffRecord = mongoose.model('StaffRecord', staffSchema);
const Reminder = mongoose.model('Reminder', reminderSchema);
const Session = mongoose.model('Session', sessionSchema);
const LOA = mongoose.model('LOA', loaSchema);
const CompletedTrainings = mongoose.model('CompletedTrainings', completedTrainingsSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Review = mongoose.model('Review', reviewSchema);
const TicketPanel = mongoose.model('TicketPanel', ticketPanelSchema);
const Birthday = mongoose.model('Birthday', birthdaySchema);
const Checklist = mongoose.model('Checklist', checklistSchema);
const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { connectDB, StaffRecord, Reminder, Session, LOA, CompletedTrainings, Ticket, Review, TicketPanel, Birthday, Checklist, Payment };
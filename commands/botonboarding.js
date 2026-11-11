/**
 * botonboarding.js — Bot Self-Training / Onboarding System for Kavià Café
 *
 * A comprehensive interactive training system that walks staff through
 * every bot command category with hands-on demos in a dedicated sandbox channel.
 *
 * Usage:
 *   /botonboarding start [user]  — start training for yourself or someone else
 *   /botonboarding blast         — (admin only) send one-time DM blast to all staff
 *   /botonboarding status        — check your current training progress
 *
 * HOW IT WORKS:
 *   1. Run /botonboarding start (optionally target another user)
 *   2. Multi-select dropdown: pick which categories to train on
 *   3. Bot creates a private #bot-training-[username] channel
 *   4. Interactive walkthrough with example commands, tips, and quizzes
 *   5. At the end: "Are you done?" prompt → marks complete or keeps channel open
 *   7. Auto-delete channel after 24h of inactivity
 *
 * WIRING IN index.js:
 *   const { handleOnboardingInteraction } = require('./commands/botonboarding');
 *   // In interactionCreate, add near top of button/select handlers:
 *   if (interaction.customId?.startsWith('ob_')) {
 *       if (await handleOnboardingInteraction(interaction, client)) return;
 *   }
 *   if (interaction.customId === 'ob_category_select') {
 *       if (await handleOnboardingInteraction(interaction, client)) return;
 *   }
 *   // Also export checkOnboardingCleanup and call it on startup + every 10 min
 */

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const mongoose = require('mongoose');

// ─── DB Schema ────────────────────────────────────────────────────────────────
const onboardingSessionSchema = new mongoose.Schema({
    userId:           String,   // trainee
    targetUserId:     String,   // who is being trained (usually same as userId)
    targetUserTag:    String,
    guildId:          String,
    channelId:        String,   // training channel ID
    categories:       [String], // selected category keys
    currentCategory:  { type: Number, default: 0 },
    currentStep:      { type: Number, default: 0 },
    completedCats:    [String],
    status:           { type: String, default: 'active' },  // active | done | abandoned
    createdAt:        { type: Date, default: Date.now },
    lastActivityAt:   { type: Date, default: Date.now }
}, { versionKey: false });
const OnboardingSession = mongoose.models.OnboardingSession
    || mongoose.model('OnboardingSession', onboardingSessionSchema);

// Tracks who has already been asked about onboarding (one-time blast)
const onboardingBlastSchema = new mongoose.Schema({
    _id:        String,  // userId
    asked:      { type: Boolean, default: true },
    response:   String,  // 'yes' | 'no'
    respondedAt: Date
}, { versionKey: false });
const OnboardingBlast = mongoose.models.OnboardingBlast
    || mongoose.model('OnboardingBlast', onboardingBlastSchema);

// ─── Constants ────────────────────────────────────────────────────────────────
// The guild where training channels are created
const TRAINING_GUILD_ID = '1434556801096876034';
// Category that training channels go under (use an existing "Staff" category or null)
const TRAINING_CATEGORY_ID = null; // set to a Discord category channel ID if desired
// Role that can run /botonboarding blast
const ADMIN_ROLE_ID = '1434563855354167358';
// Staff role(s) to include in one-time blast
const STAFF_ROLE_IDS = ['1434563855354167358', '1439608585381478471'];

const AUTO_DELETE_MS = 24 * 60 * 60 * 1000; // 24 hours of inactivity

// ─── Training Categories ───────────────────────────────────────────────────────
const CATEGORIES = {
    applications: {
        label: '📋 Applications',
        description: 'Opening, managing, and reviewing staff applications',
        emoji: '📋',
        steps: [
            {
                title: '📋 Applications — Overview',
                content: [
                    'The `/application` command manages the entire application pipeline.',
                    '',
                    '**Subcommands:**',
                    '• `/application setup` — Create a new application form (name, questions, log channel, etc.)',
                    '• `/application list` — See all forms (open and closed)',
                    '• `/application open` — Open a form so people can apply',
                    '• `/application close` — Close a form (stops new submissions)',
                    '• `/application delete` — Permanently delete a form',
                    '• `/application statusboard` — Pin a live status board in a channel',
                    '• `/application send` — Post the apply button in a specific channel',
                    '• `/application setclosedate` — Set an auto-close date on an open form',
                ].join('\n')
            },
            {
                title: '📋 Applications — Opening a Form',
                content: [
                    'When you run `/application open`, the bot walks you through a wizard:',
                    '',
                    '1️⃣ **Pick a form** — select from dropdown of existing forms',
                    '2️⃣ **Pick apply type** — DM form (applicant fills form in DMs) OR redirect to a channel',
                    '3️⃣ **Set a close date** (optional) — bot auto-closes at that time + DMs you 24h before',
                    '4️⃣ **Pick channel** — where to post the Apply button',
                    '5️⃣ **Notify role** (optional) — ping a role when form opens',
                    '',
                    '💡 **Tip:** The Status Board (`/application statusboard`) auto-updates whenever a form opens or closes — pin it in your applications channel!',
                ].join('\n')
            },
            {
                title: '📋 Applications — Reviewing Submissions',
                content: [
                    'When someone submits an application, it posts to your log channel with **Pass** / **Decline** / **Send to Ticket** buttons.',
                    '',
                    '✅ **Pass** — marks them accepted, logs it',
                    '❌ **Decline** — asks for a reason, then notifies the applicant',
                    '🎫 **Send to Ticket** — routes them to your ticket system for further review',
                    '',
                    '📌 **Re-submissions:** If a declined applicant applies again, it\'s flagged as a re-submit so reviewers know.',
                    '',
                    '💡 **Tip:** Set up a dedicated log channel per department so the right people see submissions.',
                ].join('\n')
            },
            {
                title: '📋 Applications — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'You want applications to automatically stop accepting new people on December 31st. Which command do you use?',
                    options: [
                        { id: 'a', text: '/application close' },
                        { id: 'b', text: '/application setclosedate' },
                        { id: 'c', text: '/application delete' },
                        { id: 'd', text: '/application setup with a date option' }
                    ],
                    answer: 'b',
                    explanation: '`/application setclosedate` sets an auto-close date on an already-open form. The bot will auto-close it at that time and DM you 24h before giving you a chance to extend!'
                }
            }
        ]
    },
    sessions: {
        label: '🗓️ Sessions & Scheduling',
        description: 'Weekly session schedule, requests, and history',
        emoji: '🗓️',
        steps: [
            {
                title: '🗓️ Sessions — Overview',
                content: [
                    'The session system handles **shift scheduling** for Kavià Café staff.',
                    '',
                    '**Main tools:**',
                    '• **Weekly Schedule Post** — Auto-posts every Sunday at 11 PM. Staff click day buttons to claim sessions.',
                    '• `/sesrequest` — Manual session request if the weekly post isn\'t available',
                    '• `/sessionhistory` — View a staff member\'s session history',
                    '',
                    '**How the weekly schedule works:**',
                    '1. The bot posts a schedule embed with Mon–Sun buttons',
                    '2. You click a day → modal pops up asking for time + shift type',
                    '3. A reviewer approves it in the approval channel',
                    '4. The schedule post updates to show your name on that day',
                ].join('\n')
            },
            {
                title: '🗓️ Sessions — Reminders',
                content: [
                    'Once a session is approved, reminders go out automatically:',
                    '',
                    '• **24h before** — DM reminder sent',
                    '• **12h before** — DM reminder sent',
                    '• **At session time** — "Starting now!" reminder',
                    '',
                    '**Remind Me button:** Anyone can click "Remind Me" on a session to get their own personalized reminder.',
                    '',
                    '**Co-hosting:** If you need a co-host, the system supports claiming sessions as co-host too.',
                    '',
                    '**Managing sessions:** Click "Manage My Session" on the schedule to edit time, cancel, or update your slot.',
                ].join('\n')
            },
            {
                title: '🗓️ Sessions — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'The weekly schedule post automatically appears every week. When does it post?',
                    options: [
                        { id: 'a', text: 'Monday at 9 AM' },
                        { id: 'b', text: 'Sunday at 11 PM EST' },
                        { id: 'c', text: 'Friday at midnight' },
                        { id: 'd', text: 'It only posts when an admin runs a command' }
                    ],
                    answer: 'b',
                    explanation: 'The weekly schedule post fires every **Sunday at 11 PM EST**, giving the whole week\'s schedule in advance!'
                }
            }
        ]
    },
    training: {
        label: '🎓 Staff Trainings',
        description: 'Running training sessions with /starttraining',
        emoji: '🎓',
        steps: [
            {
                title: '🎓 Trainings — Overview',
                content: [
                    'The `/starttraining` command lets trainers walk staff through interactive training modules.',
                    '',
                    '**Available trainings:**',
                    '• **Mod Basic Training** — Moderation fundamentals (includes age verification)',
                    '• **HR Basic Training** — HR procedures and policies (includes age verification)',
                    '• **Intro to Mentorship** — How to mentor new staff',
                    '• **SHR Training** — Senior HR responsibilities',
                    '',
                    '**How it works:**',
                    '1. Trainer runs `/starttraining` with the target member + training type',
                    '2. Training content is sent section by section with a "Next" button',
                    '3. At the end, there\'s a quiz — trainee must pass to complete',
                    '4. Completion is logged to the trainee\'s record',
                ].join('\n')
            },
            {
                title: '🎓 Trainings — What to Expect',
                content: [
                    'Each training has multiple **sections** then a **quiz** at the end.',
                    '',
                    '**Progress saves automatically** — if the bot restarts mid-training, it picks up where you left off.',
                    '',
                    '**Scoring:** The trainee answers multiple-choice questions. If they don\'t pass, they can retake.',
                    '',
                    '**Age Verification:** Only Mod Basic and HR Basic include an age verification step (required for moderation roles).',
                    '',
                    '💡 **Tip:** Have the trainee ready before you run the command — the training starts immediately after you submit it!',
                ].join('\n')
            },
            {
                title: '🎓 Trainings — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'Which trainings include the age verification step?',
                    options: [
                        { id: 'a', text: 'All trainings' },
                        { id: 'b', text: 'Only SHR Training' },
                        { id: 'c', text: 'Mod Basic and HR Basic only' },
                        { id: 'd', text: 'Intro to Mentorship and SHR Training' }
                    ],
                    answer: 'c',
                    explanation: 'Age verification is only included in **Mod Basic** and **HR Basic** training since those cover moderation roles that require age checks. Intro to Mentorship and SHR Training do not include it.'
                }
            }
        ]
    },
    loa: {
        label: '🌴 LOA (Leave of Absence)',
        description: 'Submitting and managing LOA requests',
        emoji: '🌴',
        steps: [
            {
                title: '🌴 LOA — Overview',
                content: [
                    'The `/loa` command lets staff submit Leave of Absence requests.',
                    '',
                    '**To submit an LOA:**',
                    '`/loa department:[your dept] reason:[why] time_gone:[duration] return_date:[DD/MM/YY]`',
                    '',
                    '**After submitting:**',
                    '1. The request appears in a staff channel for approval',
                    '2. Approver clicks Approve or Deny',
                    '3. If approved, bot sets a return reminder for the return date',
                    '4. When the return date passes, the bot reminds the staff member',
                    '',
                    '**To view current LOAs:** Staff with the right role can use `/loalist` to see all active LOAs by department.',
                ].join('\n')
            },
            {
                title: '🌴 LOA — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'What format should the return date be in when submitting an LOA?',
                    options: [
                        { id: 'a', text: 'MM/DD/YYYY' },
                        { id: 'b', text: 'DD/MM/YY' },
                        { id: 'c', text: 'YYYY-MM-DD' },
                        { id: 'd', text: 'Any date format works' }
                    ],
                    answer: 'b',
                    explanation: 'The `/loa` command expects dates in **DD/MM/YY** format. For example: `25/12/26` for December 25th, 2026.'
                }
            }
        ]
    },
    resign: {
        label: '🚪 Resignations',
        description: 'Logging staff resignations',
        emoji: '🚪',
        steps: [
            {
                title: '🚪 Resignations — Overview',
                content: [
                    'The `/resign` command logs staff resignations formally.',
                    '',
                    '**Usage:**',
                    '`/resign department:[dept] staff_member:[@user] reason:[reason] last_day:[date]`',
                    '',
                    '**What happens:**',
                    '1. A resignation record is created in the system',
                    '2. It posts to a resign log channel for the department',
                    '3. The record is permanently stored for reference',
                    '',
                    '💡 **Tip:** Always log resignations through the bot — it keeps a clean record of all departures and their reasons.',
                ].join('\n')
            },
            {
                title: '🚪 Resignations — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'Who should run the /resign command?',
                    options: [
                        { id: 'a', text: 'The staff member who is resigning, for themselves' },
                        { id: 'b', text: 'An authorized staff member logging the resignation on behalf of the person' },
                        { id: 'c', text: 'Only the server owner' },
                        { id: 'd', text: 'Anyone in the server' }
                    ],
                    answer: 'b',
                    explanation: 'An **authorized staff member** (HR/admin) logs the resignation. The `/resign` command takes a `staff_member` parameter — you specify who is resigning, not run it yourself.'
                }
            }
        ]
    },
    giveaway: {
        label: '🎉 Giveaways',
        description: 'Creating and managing community giveaways',
        emoji: '🎉',
        steps: [
            {
                title: '🎉 Giveaways — Overview',
                content: [
                    'The `/giveaway` command runs timed community giveaways.',
                    '',
                    '**Subcommands:**',
                    '• `/giveaway start` — Launch a new giveaway',
                    '• `/giveaway reroll` — Pick new winner(s) from a past giveaway',
                    '',
                    '**Starting a giveaway:**',
                    '`/giveaway start prize:[what you\'re giving] duration:[#] duration_unit:[minutes/hours/days]`',
                    '',
                    '**Optional settings:**',
                    '• `winners` — how many winners (default: 1)',
                    '• `required_messages` — min messages needed to enter',
                    '• `selection` — random or weighted (by message count)',
                    '• `channel` — where to post it',
                    '',
                    '**When it ends:** Bot picks winner(s), announces them, and stores results.',
                ].join('\n')
            },
            {
                title: '🎉 Giveaways — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'You want to give more entries to active chatters. Which "selection" option do you use?',
                    options: [
                        { id: 'a', text: 'random' },
                        { id: 'b', text: 'fair' },
                        { id: 'c', text: 'weighted' },
                        { id: 'd', text: 'activity' }
                    ],
                    answer: 'c',
                    explanation: '**Weighted** selection gives more entries to users with higher message counts, rewarding active community members!'
                }
            }
        ]
    },
    tickets: {
        label: '🎫 Tickets',
        description: 'Ticket panels, claiming, and managing support tickets',
        emoji: '🎫',
        steps: [
            {
                title: '🎫 Tickets — Overview',
                content: [
                    'The ticket system handles **support requests** from community members.',
                    '',
                    '**Setting up tickets:**',
                    '• A ticket panel is created in a channel (via ticket setup commands)',
                    '• Users click a category button to open a ticket',
                    '• A private ticket channel is created for them',
                    '',
                    '**For staff:**',
                    '• **Claim** a ticket — assigns it to you so others know you\'re handling it',
                    '• **Close** a ticket — archives and closes the channel',
                    '• **Review** — after close, staff can be rated',
                    '',
                    '💡 **Tip:** Always claim a ticket before replying so others don\'t duplicate effort!',
                ].join('\n')
            },
            {
                title: '🎫 Tickets — Application Tickets',
                content: [
                    'Applications can route to tickets via **"Send to Ticket"** on the submission review.',
                    '',
                    'When this happens:',
                    '1. The applicant is told to open a ticket',
                    '2. The bot watches for their ticket to open (48h window)',
                    '3. When they open it, the ticket is linked to their application',
                    '4. The original submission updates with a link to the ticket',
                    '',
                    'This is useful for borderline applications that need a conversation before deciding.',
                ].join('\n')
            },
            {
                title: '🎫 Tickets — Quiz',
                content: '__QUIZ__',
                quiz: {
                    question: 'Why is it important to "claim" a ticket before replying?',
                    options: [
                        { id: 'a', text: 'You can only reply to tickets you\'ve claimed' },
                        { id: 'b', text: 'It signals to other staff that you\'re handling it, preventing duplicate effort' },
                        { id: 'c', text: 'It unlocks special ticket commands' },
                        { id: 'd', text: 'It automatically closes the ticket when you\'re done' }
                    ],
                    answer: 'b',
                    explanation: 'Claiming a ticket **signals to other staff** that you\'re handling it. This prevents two people from working on the same ticket without knowing about each other!'
                }
            }
        ]
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function categoryKeys() { return Object.keys(CATEGORIES); }

function buildCategorySelectMenu(preselected = []) {
    const opts = categoryKeys().map(k => {
        const cat = CATEGORIES[k];
        return new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setDescription(cat.description.slice(0, 100))
            .setValue(k)
            .setEmoji(cat.emoji)
            .setDefault(preselected.includes(k));
    });
    return new StringSelectMenuBuilder()
        .setCustomId('ob_category_select')
        .setPlaceholder('Select training categories (can pick multiple)')
        .setMinValues(1)
        .setMaxValues(opts.length)
        .addOptions(opts);
}

function progressBar(current, total) {
    const filled = Math.round((current / total) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${current}/${total}`;
}

async function getSession(userId) {
    return OnboardingSession.findOne({ userId, status: 'active' });
}

async function sendStep(channel, session) {
    const catKey = session.categories[session.currentCategory];
    if (!catKey) return; // all done
    const cat = CATEGORIES[catKey];
    const step = cat.steps[session.currentStep];
    if (!step) return;

    const totalSteps = session.categories.reduce((acc, k) => acc + CATEGORIES[k].steps.length, 0);
    const completedSteps = session.categories.slice(0, session.currentCategory)
        .reduce((acc, k) => acc + CATEGORIES[k].steps.length, 0) + session.currentStep;

    const isQuiz = step.content === '__QUIZ__';

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(step.title)
        .setFooter({ text: `📊 Progress: ${progressBar(completedSteps, totalSteps)} | Kavià Café Bot Training` })
        .setTimestamp();

    if (isQuiz) {
        const q = step.quiz;
        embed.setDescription(
            `**📝 Quick Quiz!**\n\n${q.question}\n\n` +
            q.options.map(o => `**${o.id.toUpperCase()}.** ${o.text}`).join('\n')
        );

        const row = new ActionRowBuilder().addComponents(
            ...q.options.map(o =>
                new ButtonBuilder()
                    .setCustomId(`ob_quiz_${o.id}_${session.userId}`)
                    .setLabel(o.id.toUpperCase())
                    .setStyle(ButtonStyle.Secondary)
            )
        );
        await channel.send({ embeds: [embed], components: [row] });
    } else {
        embed.setDescription(step.content);

        const isFirst = session.currentStep === 0 && session.currentCategory === 0;
        const isLast  = session.currentStep === cat.steps.length - 1 && session.currentCategory === session.categories.length - 1;

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ob_prev_${session.userId}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(isFirst),
            new ButtonBuilder()
                .setCustomId(`ob_next_${session.userId}`)
                .setLabel(isLast ? '🏁 Finish Training' : '➡️ Next')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`ob_end_${session.userId}`)
                .setLabel('🛑 End Training')
                .setStyle(ButtonStyle.Danger)
        );
        await channel.send({ embeds: [embed], components: [navRow] });
    }

    // Update last activity
    await OnboardingSession.findByIdAndUpdate(session._id, { lastActivityAt: new Date() });
}

async function advanceSession(session, client) {
    const cat = CATEGORIES[session.categories[session.currentCategory]];
    let nextStep = session.currentStep + 1;
    let nextCat = session.currentCategory;

    if (nextStep >= cat.steps.length) {
        // Mark this category complete
        const completedCats = [...(session.completedCats || []), session.categories[session.currentCategory]];
        nextCat++;
        nextStep = 0;
        await OnboardingSession.findByIdAndUpdate(session._id, {
            currentCategory: nextCat,
            currentStep: 0,
            completedCats,
            lastActivityAt: new Date()
        });
        session.currentCategory = nextCat;
        session.currentStep = 0;
    } else {
        await OnboardingSession.findByIdAndUpdate(session._id, {
            currentStep: nextStep,
            lastActivityAt: new Date()
        });
        session.currentStep = nextStep;
    }

    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel) return;

    if (session.currentCategory >= session.categories.length) {
        // ALL DONE
        await finishTraining(session, channel, client);
    } else {
        // Show category header if we just moved to a new category
        if (nextStep === 0 && nextCat > 0) {
            const newCatKey = session.categories[nextCat];
            const newCat = CATEGORIES[newCatKey];
            await channel.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle(`✅ "${CATEGORIES[session.categories[nextCat - 1]].label}" Complete!`)
                    .setDescription(`Next up: **${newCat.label}**\n\n${newCat.description}`)
                    .setTimestamp()]
            });
        }
        const refreshed = await OnboardingSession.findById(session._id);
        await sendStep(channel, refreshed);
    }
}

async function finishTraining(session, channel, client) {
    await OnboardingSession.findByIdAndUpdate(session._id, { status: 'done' });

    const catList = session.categories.map(k => `✅ ${CATEGORIES[k].label}`).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('🎉 Training Complete!')
        .setDescription(
            `**Amazing work, <@${session.targetUserId}>!** You've completed your bot onboarding training!\n\n` +
            `**Categories completed:**\n${catList}\n\n` +
            `You're now fully trained on these bot systems. This channel will be **deleted in 10 minutes** automatically.\n\n` +
            `*If you need to reference anything, check the bot's help docs or ask a senior staff member.*`
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ob_close_now_${session.userId}`)
            .setLabel('🗑️ Delete Channel Now')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ob_keep_open_${session.userId}`)
            .setLabel('📌 Keep Open a Bit Longer')
            .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [embed], components: [row] });

    // Schedule delete in 10 minutes (extend via button to full 24h)
    setTimeout(async () => {
        const s = await OnboardingSession.findById(session._id);
        if (s && s.status === 'done') {
            await cleanupSession(session._id, client);
        }
    }, 10 * 60 * 1000);
}

async function cleanupSession(sessionId, client) {
    const session = await OnboardingSession.findById(sessionId);
    if (!session) return;

    // Delete training channel
    const ch = await client.channels.fetch(session.channelId).catch(() => null);
    if (ch) await ch.delete('Bot training complete — cleanup').catch(() => {});

    await OnboardingSession.findByIdAndUpdate(sessionId, { status: 'abandoned' });
}

// ─── Main Interaction Handler ─────────────────────────────────────────────────
async function handleOnboardingInteraction(interaction, client) {
    const id = interaction.customId || '';

    // Guild picker — user selected which server to create training channel in
    if (id === 'ob_guild_select') {
        const session = await getSession(interaction.user.id);
        if (!session) return false;
        try { await interaction.deferUpdate(); } catch { return true; }

        const chosenGuildId = interaction.values[0];
        const chosenGuild = await client.guilds.fetch(chosenGuildId).catch(() => null);
        if (!chosenGuild) {
            await interaction.editReply({ content: '❌ Could not find that server.', components: [], embeds: [] });
            return true;
        }

        await OnboardingSession.findByIdAndUpdate(session._id, { guildId: chosenGuildId });

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎓 Bot Onboarding Training')
            .setDescription(
                `Training channel will be created in **${chosenGuild.name}**.\n\n` +
                `Select which **categories** to cover, or click **Train All** to do everything at once.`
            )
            .setFooter({ text: 'Kavià Café Bot Training System' });

        const trainAllRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ob_train_all').setLabel('🚀 Train All Categories').setStyle(ButtonStyle.Success)
        );
        const selectRow = new ActionRowBuilder().addComponents(buildCategorySelectMenu());
        await interaction.editReply({ embeds: [embed], components: [trainAllRow, selectRow] });
        return true;
    }

    // Train All button — select every category at once
    if (id === 'ob_train_all') {
        const session = await getSession(interaction.user.id);
        if (!session) return false;
        try { await interaction.deferUpdate(); } catch { return true; }

        const allKeys = categoryKeys();
        await OnboardingSession.findByIdAndUpdate(session._id, { categories: allKeys });
        session.categories = allKeys;

        const guildId = session.guildId && session.guildId !== 'pending' ? session.guildId : TRAINING_GUILD_ID;
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            await interaction.editReply({ content: '❌ Could not find training guild.', components: [], embeds: [] });
            return true;
        }

        const trainee = await client.users.fetch(session.targetUserId).catch(() => null);
        const channelName = `bot-training-${trainee?.username?.toLowerCase().replace(/[^a-z0-9]/g, '') || session.targetUserId}`;

        const trainingChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TRAINING_CATEGORY_ID || undefined,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                { id: session.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                ...(session.targetUserId !== session.userId ? [{ id: session.targetUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
            ],
            topic: `Bot training session for ${trainee?.tag || session.targetUserId} — auto-deletes after 24h of inactivity`
        }).catch(() => null);

        if (!trainingChannel) {
            await interaction.editReply({ content: '❌ Failed to create training channel. Check bot permissions.', components: [], embeds: [] });
            return true;
        }

        await OnboardingSession.findByIdAndUpdate(session._id, { channelId: trainingChannel.id });
        session.channelId = trainingChannel.id;

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('✅ Training Channel Created!')
                .setDescription(`Your training channel is ready: ${trainingChannel}\n\nHead over there to begin!`)],
            components: []
        });

        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎓 Welcome to Bot Training!')
            .setDescription(
                `Hey ${trainee ? `<@${session.targetUserId}>` : 'there'}! 👋\n\n` +
                `You're training on **all ${allKeys.length} categories**:\n` +
                allKeys.map(k => `> ${CATEGORIES[k].label}`).join('\n') +
                `\n\nThis channel auto-deletes after **24 hours of inactivity**.\n\nLet's get started! 🚀`
            )
            .setFooter({ text: 'Kavià Café Bot Training System' });

        await trainingChannel.send({ embeds: [welcomeEmbed] });

        setTimeout(() => sendStep(trainingChannel, session), 1500);
        return true;
    }

    // Category select menu
    if (id === 'ob_category_select') {
        const session = await getSession(interaction.user.id);
        if (!session) return false;

        try { await interaction.deferUpdate(); } catch { return true; }

        const selected = interaction.values;
        await OnboardingSession.findByIdAndUpdate(session._id, {
            categories: selected,
            currentCategory: 0,
            currentStep: 0,
            lastActivityAt: new Date()
        });

        // Create the training channel in the guild the user selected
        const targetGuildId = session.guildId && session.guildId !== 'pending' ? session.guildId : TRAINING_GUILD_ID;
        const guild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (!guild) {
            await interaction.editReply({ content: '❌ Could not find the training guild.', components: [] });
            return true;
        }

        const channelName = `bot-training-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const trainingChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                // Also give access if training someone else
                ...(session.targetUserId !== interaction.user.id
                    ? [{ id: session.targetUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }]
                    : [])
            ],
            topic: `Bot onboarding training for ${session.targetUserTag} | Auto-deletes after 24h`,
            ...(TRAINING_CATEGORY_ID ? { parent: TRAINING_CATEGORY_ID } : {})
        }).catch(e => { console.error('Failed to create training channel', e); return null; });

        if (!trainingChannel) {
            await interaction.editReply({ content: '❌ Could not create training channel. Check bot permissions.', components: [] });
            return true;
        }

        await OnboardingSession.findByIdAndUpdate(session._id, { channelId: trainingChannel.id });
        session.channelId = trainingChannel.id;
        session.categories = selected;

        await interaction.editReply({
            content: `✅ Training channel created! Head to <#${trainingChannel.id}> to begin.`,
            components: []
        });

        // Send welcome + first step in training channel
        const catList = selected.map(k => `${CATEGORIES[k].emoji} **${CATEGORIES[k].label}**`).join('\n');
        await trainingChannel.send({
            content: `<@${session.targetUserId}>`,
            embeds: [new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('👋 Welcome to Bot Onboarding Training!')
                .setDescription(
                    `Hey <@${session.targetUserId}>! Let\'s get you trained on the Kavià Café bot systems.\n\n` +
                    `**You\'ll be covering:**\n${catList}\n\n` +
                    `React to each step by clicking the buttons. If you stop responding, this channel auto-deletes in **24 hours**.\n\n` +
                    `Let\'s dive in! 🚀`
                )
                .setTimestamp()]
        });

        const freshSession = await OnboardingSession.findById(session._id);
        await sendStep(trainingChannel, freshSession);
        return true;
    }

    // Next step button
    // End training early
    if (id.startsWith('ob_end_')) {
        const traineeId = id.replace('ob_end_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) return false;
        if (interaction.user.id !== traineeId && interaction.user.id !== session.userId) {
            await interaction.reply({ content: '❌ Only the trainer or trainee can end this training.', flags: 64 });
            return true;
        }
        try { await interaction.deferUpdate(); } catch { return true; }

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('🛑 End Training?')
                .setDescription('Are you sure you want to end training early? The channel will be deleted in 10 seconds.')],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ob_end_confirm_${traineeId}`).setLabel('✅ Yes, End It').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ob_end_cancel_${traineeId}`).setLabel('↩️ Go Back').setStyle(ButtonStyle.Secondary)
            )]
        });
        return true;
    }

    if (id.startsWith('ob_end_confirm_')) {
        const traineeId = id.replace('ob_end_confirm_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) return false;
        try { await interaction.deferUpdate(); } catch { return true; }
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🛑 Training Ended').setDescription('Training has been ended. This channel will be deleted in **10 seconds**.')],
            components: []
        });
        setTimeout(() => cleanupSession(session._id, client), 10000);
        return true;
    }

    if (id.startsWith('ob_end_cancel_')) {
        const traineeId = id.replace('ob_end_cancel_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) return false;
        try { await interaction.deferUpdate(); } catch { return true; }
        // Re-send the current step
        const channel = await client.channels.fetch(session.channelId).catch(() => null);
        if (channel) await sendStep(channel, session);
        await interaction.editReply({ embeds: [], components: [], content: '↩️ Returned to training.' });
        return true;
    }

    // Go back to previous step
    if (id.startsWith('ob_prev_')) {
        const traineeId = id.replace('ob_prev_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) return false;
        if (interaction.user.id !== traineeId && interaction.user.id !== session.userId) {
            await interaction.reply({ content: '❌ Only the trainer or trainee can navigate this training.', flags: 64 });
            return true;
        }
        try { await interaction.deferUpdate(); } catch { return true; }

        // Step back
        let prevStep = session.currentStep - 1;
        let prevCat  = session.currentCategory;

        if (prevStep < 0) {
            // Go to end of previous category
            prevCat = session.currentCategory - 1;
            if (prevCat < 0) {
                await interaction.editReply({ content: 'ℹ️ Already at the beginning!', components: [] });
                return true;
            }
            const prevCatKey = session.categories[prevCat];
            prevStep = CATEGORIES[prevCatKey].steps.length - 1;
        }

        await OnboardingSession.findByIdAndUpdate(session._id, {
            currentCategory: prevCat,
            currentStep: prevStep,
            lastActivityAt: new Date()
        });
        session.currentCategory = prevCat;
        session.currentStep = prevStep;

        const channel = await client.channels.fetch(session.channelId).catch(() => null);
        if (channel) await sendStep(channel, session);
        await interaction.editReply({ embeds: [], components: [], content: '⬅️ Went back.' });
        return true;
    }

    if (id.startsWith('ob_next_')) {
        const traineeId = id.replace('ob_next_', '');
        // Allow the trainer OR the trainee to click next
        if (interaction.user.id !== traineeId) {
            const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
            if (!session) return false;
            // Allow if the person is the trainer (started the session)
            if (interaction.user.id !== session.userId) {
                await interaction.reply({ content: '❌ Only the trainer or trainee can advance this training.', flags: 64 });
                return true;
            }
        }

        try { await interaction.deferUpdate(); } catch { return true; }

        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) {
            await interaction.editReply({ content: '❌ No active training session found.', components: [] });
            return true;
        }

        // Remove buttons from current message
        await interaction.editReply({ components: [] });
        await advanceSession(session, client);
        return true;
    }

    // Quiz answer
    if (id.startsWith('ob_quiz_')) {
        const parts = id.split('_');
        const answer = parts[2];
        const traineeId = parts[3];

        const session = await OnboardingSession.findOne({ userId: traineeId, status: 'active' });
        if (!session) return false;

        try { await interaction.deferUpdate(); } catch { return true; }

        const catKey = session.categories[session.currentCategory];
        const step = CATEGORIES[catKey].steps[session.currentStep];
        const quiz = step.quiz;
        const correct = answer === quiz.answer;

        const resultEmbed = new EmbedBuilder()
            .setColor(correct ? 0x57f287 : 0xed4245)
            .setTitle(correct ? '✅ Correct!' : '❌ Not quite...')
            .setDescription(
                `${correct ? '🎉 Well done!' : `The correct answer was **${quiz.answer.toUpperCase()}. ${quiz.options.find(o => o.id === quiz.answer).text}**`}\n\n` +
                `📖 **Explanation:** ${quiz.explanation}`
            );

        await interaction.editReply({ embeds: [resultEmbed], components: [] });

        // Always advance after quiz (they got the explanation either way)
        setTimeout(() => advanceSession(session, client), 2000);
        return true;
    }

    // Close training channel now
    if (id.startsWith('ob_close_now_')) {
        const traineeId = id.replace('ob_close_now_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId });
        if (!session) return false;

        if (interaction.user.id !== session.userId && interaction.user.id !== session.targetUserId) {
            await interaction.reply({ content: '❌ Only the trainer or trainee can close this channel.', flags: 64 });
            return true;
        }

        try { await interaction.deferUpdate(); } catch { return true; }
        await interaction.editReply({ content: '🗑️ Deleting training channel in 5 seconds...', components: [] });
        setTimeout(() => cleanupSession(session._id, client), 5000);
        return true;
    }

    // Keep channel open (extend auto-delete to 24h from now)
    if (id.startsWith('ob_keep_open_')) {
        const traineeId = id.replace('ob_keep_open_', '');
        const session = await OnboardingSession.findOne({ userId: traineeId });
        if (!session) return false;

        try { await interaction.deferUpdate(); } catch { return true; }
        await OnboardingSession.findByIdAndUpdate(session._id, { lastActivityAt: new Date() });
        await interaction.editReply({
            content: '✅ Channel kept open! It will auto-delete in **24 hours** from now.',
            components: []
        });
        return true;
    }

    // Blast response — Yes
    if (id.startsWith('ob_blast_yes_')) {
        const userId = id.replace('ob_blast_yes_', '');
        if (interaction.user.id !== userId) return false;

        try { await interaction.deferUpdate(); } catch { return true; }
        await OnboardingBlast.findByIdAndUpdate(userId, { response: 'yes', respondedAt: new Date() }, { upsert: true });

        await interaction.editReply({
            content: '✅ Awesome! Head to your server and run `/botonboarding start` to kick off your training session! 🎓',
            components: []
        });
        return true;
    }

    // Blast response — No
    if (id.startsWith('ob_blast_no_')) {
        const userId = id.replace('ob_blast_no_', '');
        if (interaction.user.id !== userId) return false;

        try { await interaction.deferUpdate(); } catch { return true; }
        await OnboardingBlast.findByIdAndUpdate(userId, { response: 'no', respondedAt: new Date() }, { upsert: true });

        await interaction.editReply({
            content: 'No worries! You won\'t be asked again. If you ever want to do the training, just run `/botonboarding start` anytime! 👋',
            components: []
        });
        return true;
    }

    return false; // not our interaction
}

// ─── Auto-cleanup scheduler ───────────────────────────────────────────────────
async function checkOnboardingCleanup(client) {
    const cutoff = new Date(Date.now() - AUTO_DELETE_MS);
    const staleSessions = await OnboardingSession.find({
        status: 'active',
        lastActivityAt: { $lt: cutoff }
    }).catch(() => []);

    for (const session of staleSessions) {
        try {
            const ch = await client.channels.fetch(session.channelId).catch(() => null);
            if (ch) {
                await ch.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0xed4245)
                        .setTitle('⏰ Training Session Abandoned')
                        .setDescription('This training channel has been inactive for 24 hours and will now be deleted.')
                        .setTimestamp()]
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            }
            await cleanupSession(session._id, client);
        } catch (e) {
            console.error('Error cleaning up onboarding session', e);
        }
    }
}

// ─── Send One-Time Blast to All Staff ─────────────────────────────────────────
async function sendOnboardingBlast(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    const guild = await client.guilds.fetch(TRAINING_GUILD_ID).catch(() => null);
    if (!guild) return interaction.editReply('❌ Could not fetch guild.');

    await guild.members.fetch();
    const staffMembers = guild.members.cache.filter(m =>
        !m.user.bot && STAFF_ROLE_IDS.some(r => m.roles.cache.has(r))
    );

    // Find who hasn't been asked yet
    const alreadyAsked = await OnboardingBlast.find({}).catch(() => []);
    const askedIds = new Set(alreadyAsked.map(r => r._id));
    const toAsk = staffMembers.filter(m => !askedIds.has(m.user.id));

    if (toAsk.size === 0) {
        return interaction.editReply('ℹ️ All staff members have already been asked about onboarding training!');
    }

    let sent = 0, failed = 0;
    for (const [, member] of toAsk) {
        try {
            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🎓 Bot Onboarding Training — Want to Try It?')
                .setDescription(
                    `Hey ${member.user.username}! 👋\n\n` +
                    `Kavià Café has a **brand-new bot onboarding training system** to help staff learn all the bot commands!\n\n` +
                    `It covers:\n` +
                    `• 📋 Applications\n• 🗓️ Sessions & Scheduling\n• 🎓 Staff Trainings\n• 🌴 LOA\n• 🚪 Resignations\n• 🎉 Giveaways\n• 🎫 Tickets\n\n` +
                    `**Would you like to go through the training?**\n` +
                    `*(You can also run \`/botonboarding start\` anytime to do it yourself!)*`
                )
                .setFooter({ text: 'Kavià Café Staff Bot • One-time message' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ob_blast_yes_${member.user.id}`)
                    .setLabel('✅ Yes, train me!')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`ob_blast_no_${member.user.id}`)
                    .setLabel('❌ No thanks')
                    .setStyle(ButtonStyle.Danger)
            );

            await member.send({ embeds: [embed], components: [row] });
            await OnboardingBlast.findByIdAndUpdate(member.user.id, { asked: true }, { upsert: true });
            sent++;
            await new Promise(r => setTimeout(r, 500)); // rate limit friendly
        } catch (e) {
            failed++;
        }
    }

    await interaction.editReply(
        `✅ Blast sent!\n• **${sent}** DMs delivered\n• **${failed}** failed (DMs closed)\n\n` +
        `Staff who say Yes will be directed to run \`/botonboarding start\`.`
    );
}

// ─── Slash Command ─────────────────────────────────────────────────────────────
const data = new SlashCommandBuilder()
    .setName('botonboarding')
    .setDescription('Interactive bot training system')
    .addSubcommand(sub => sub
        .setName('start')
        .setDescription('Start a bot onboarding training session')
        .addUserOption(o => o
            .setName('user')
            .setDescription('Train someone else (leave blank for yourself)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub => sub
        .setName('status')
        .setDescription('Check your current training session status')
    )
    .addSubcommand(sub => sub
        .setName('blast')
        .setDescription('(Admin) Send one-time training invite DM to all staff')
    );

async function execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        // Check for existing active session
        const existing = await OnboardingSession.findOne({ userId: interaction.user.id, status: 'active' });
        if (existing) {
            const ch = await client.channels.fetch(existing.channelId).catch(() => null);
            if (ch) {
                return interaction.reply({
                    content: `⚠️ You already have an active training session in <#${existing.channelId}>! Finish or abandon it first.`,
                    flags: 64
                });
            } else {
                // Channel was deleted, clean up
                await OnboardingSession.findByIdAndUpdate(existing._id, { status: 'abandoned' });
            }
        }

        // Create session record (channelId + guildId filled in after guild selection)
        await OnboardingSession.create({
            userId: interaction.user.id,
            targetUserId: targetUser.id,
            targetUserTag: targetUser.tag || targetUser.username,
            guildId: 'pending',
            channelId: 'pending',
            categories: [],
            status: 'active'
        });

        // Build a list of guilds the bot shares with the target user
        const sharedGuilds = [];
        for (const guild of client.guilds.cache.values()) {
            const member = await guild.members.fetch(targetUser.id).catch(() => null);
            if (member) sharedGuilds.push(guild);
        }

        if (sharedGuilds.length === 0) {
            await OnboardingSession.deleteOne({ userId: interaction.user.id, status: 'active' });
            return interaction.reply({ content: '❌ The bot doesn\'t share any servers with that user.', flags: 64 });
        }

        if (sharedGuilds.length === 1) {
            // Only one server — skip the picker and store it directly
            await OnboardingSession.findOneAndUpdate(
                { userId: interaction.user.id, status: 'active' },
                { guildId: sharedGuilds[0].id }
            );
            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🎓 Bot Onboarding Training')
                .setDescription(
                    `${targetUser.id !== interaction.user.id ? `You're setting up training for **${targetUser.username}**.\n\n` : ''}` +
                    `Training channel will be created in **${sharedGuilds[0].name}**.\n\n` +
                    `Select which **categories** to cover, or click **Train All** to do everything at once.`
                )
                .setFooter({ text: 'Kavià Café Bot Training System' });
            const trainAllRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ob_train_all').setLabel('🚀 Train All Categories').setStyle(ButtonStyle.Success)
            );
            const selectRow = new ActionRowBuilder().addComponents(buildCategorySelectMenu());
            return interaction.reply({ embeds: [embed], components: [trainAllRow, selectRow], flags: 64 });
        }

        // Multiple servers — show guild picker
        const guildOptions = sharedGuilds.slice(0, 25).map(g =>
            new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(g.id).setDescription(`Create training channel in ${g.name}`)
        );
        const guildSelect = new StringSelectMenuBuilder()
            .setCustomId('ob_guild_select')
            .setPlaceholder('Pick a server for the training channel')
            .addOptions(guildOptions);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎓 Bot Onboarding Training — Pick a Server')
            .setDescription(
                `${targetUser.id !== interaction.user.id ? `Setting up training for **${targetUser.username}**.\n\n` : ''}` +
                `Which server should the **private training channel** be created in?`
            )
            .setFooter({ text: 'Kavià Café Bot Training System' });

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(guildSelect)], flags: 64 });
        return;
    }

    if (sub === 'status') {
        const session = await OnboardingSession.findOne({ userId: interaction.user.id, status: 'active' });
        if (!session) {
            return interaction.reply({
                content: 'ℹ️ You don\'t have an active training session. Run `/botonboarding start` to begin!',
                flags: 64
            });
        }

        const catName = session.categories[session.currentCategory]
            ? CATEGORIES[session.categories[session.currentCategory]]?.label
            : 'Complete';
        const catCount = session.categories.length;
        const completedCount = session.completedCats?.length || 0;

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('📊 Training Status')
                .addFields(
                    { name: 'Training Channel', value: `<#${session.channelId}>`, inline: true },
                    { name: 'Current Category', value: catName, inline: true },
                    { name: 'Progress', value: `${completedCount}/${catCount} categories`, inline: true }
                )
                .setTimestamp()],
            flags: 64
        });
        return;
    }

    if (sub === 'blast') {
        // Check admin role
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need admin permissions to send the onboarding blast.', flags: 64 });
        }
        await sendOnboardingBlast(interaction, client);
        return;
    }
}

module.exports = {
    data,
    execute,
    handleOnboardingInteraction,
    checkOnboardingCleanup,
    OnboardingSession,
    OnboardingBlast
};
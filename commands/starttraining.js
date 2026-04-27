const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CompletedTrainings } = require('../db');

// ========== DEPT CONFIG ==========
const TRAINING_DEPTS = {
    'Mod': {
        serverId: '1301333604315561994',
        logChannelId: '1485349514486480947',
        roleId: '1495951292605009930',
        pingRoleId: '1495951292605009930'
    },
    'Human Resources': {
        serverId: '1434556801096876034',
        logChannelId: '1496259091935399956',
        roleId: '1484973859513045224',
        pingRoleId: '1484973859513045224'
    }
};

const OTHER_DEPTS = [
    'SHR', 'PR Member', 'MR Member', 'HR Member',
    'Media Team', 'Development Member', 'Development Tester'
];

const ALL_DEPT_CHOICES = [
    { name: 'Mod', value: 'Mod' },
    { name: 'Human Resources', value: 'Human Resources' },
    { name: 'SHR', value: 'SHR' },
    { name: 'PR Member', value: 'PR Member' },
    { name: 'MR Member', value: 'MR Member' },
    { name: 'HR Member', value: 'HR Member' },
    { name: 'Media Team', value: 'Media Team' },
    { name: 'Development Member', value: 'Development Member' },
    { name: 'Development Tester', value: 'Development Tester' }
];

const TRAINING_CHOICES = [
    { name: 'Basic Training', value: 'Basic Training' },
    { name: 'Intro to Mentorship', value: 'Intro to Mentorship' }
];

// ========== TRAINING CONTENT ==========

const INTRO_TO_MENTORSHIP_SECTIONS = [
    {
        title: '📕 Intro to Mentorship',
        content: `Congratulations on passing your application! Welcome to your mentorship, where you will learn the fundamentals to being an HR here at Kavià Café.\n\nIf you have a question at any time, feel free to click the help button. This will notify your department leadership and they will reach out to you to provide assistance.\n\nYou will have **1 week** to successfully complete the introductory mentorship.`
    },
    {
        title: '📋 Age Verification',
        content: `Before proceeding to the next stage of your internship, you are required to complete age verification to confirm that you are **13 years of age or older**.\n\nTo verify your age, please follow these steps:\n1. Open the Roblox App\n2. Go to Settings\n3. Select Account Info\n4. Navigate to Personal\n5. Take a screenshot of the attached page\n\nYou are allowed to cross out or blur any other personal information shown in the image for your privacy. However, your **username and age must remain visible**.\n\n**Privacy Notice**\nAt Kavià Café, we respect and value your privacy. Your age verification screenshot will only be reviewed for confirmation purposes and will not be shared outside of the designated verification channel.\n\n-# If it is confirmed that you are under the age of 13, you will be removed from the community in accordance with platform policies. Refusal to complete age verification will result in immediate termination of your internship.\n\n**Please send your screenshot or image link as a reply to this DM. A staff member will review it shortly.**`
    },
    {
        title: '🎫 Ticket Information',
        content: `As part of your responsibilities as a staff member, you will also assist with responding to support tickets. These tickets allow members to ask questions, report issues, or request assistance from the Kavià Café team.\n\nKavià Café currently uses the following ticket categories:\n> **General Support**\n> **Moderation Support**\n> **Public Relations Support**\n> **Human Resources Support**\n> **Development**\n> **SHR**\n\n• **General Support** tickets are visible to all High Ranks.\n• **Department-specific tickets** are only visible to staff members assigned to those respective departments.\n\n**Expectations When Responding to Tickets**\nBefore sending a message in a ticket, ensure the ticket has not already been claimed by another High Rank. If the ticket has not been claimed, you may claim it and introduce yourself before assisting the member.\n\n**Example Introduction Message**\n*"Hello! My name is (name), and I will be assisting you with this ticket. Please let me know your inquiry"*\n\nIf the individual does not reply after 48 hours, you may close the ticket.`
    },
    {
        title: '❌ Incorrect Tickets & Staff Server Duties',
        content: `It may occur that someone opens the wrong ticket type. If this happens, immediately close the ticket. Do **not** claim it.\n\n> **SHR tickets →** *Resignations of any rank, Presidential staff reports, Critical issues.*\n> **Public Relations tickets →** *Alliances, Reports of Alliances, giveaways, event winner roles.*\n> **Moderation tickets →** *Moderator needed, rule violations, role issues.*\n> **Human Resources Tickets →** *LR-HR reports, Promotions, Demotions, Applications.*\n> **Development Tickets →** *Development applications, Beta tester applications.*\n> **General Tickets →** *General questions, minor issues.*\n\n-# Presidential staff reports MUST be directed to a specific rank. AA reports may be handled by Vice President and up, Vice President reports by President and up, Vice Chairperson reports to Chairperson, and Chairperson reports go directly to Ownership.\n\n⚠️ **If you do not know how to assist with a certain issue, do NOT claim. Ask for help.**\n-# Proper grammar is not required when responding to tickets, but professionalism is mandatory at all times.\n\n**Staff Server Duties**\nWithin the staff server, you will receive the ban handler role. Its usage is for when an MR needs a troll banned. Please leave exploiter tickets to the SHR team.\n\n**New Admin Privileges**\nAlong with your new position you will also receive permissions to ban members in our facilities. Please do not abuse these powers as you will immediately be terminated.\n-# Any attempt to raid will be immediately shut down and will lead to a global ban.`
    }
];

const INTRO_TO_MENTORSHIP_QUIZ = [
    {
        question: 'A High Rank staff member has joined the **Public Relations Department**. Which ticket type can they see?',
        options: { A: 'Moderation Support', B: 'Development', C: 'Public Relations + General Support', D: 'SHR + Human Resources Support' },
        answer: 'C'
    },
    {
        question: 'A user creates a **General Support** ticket. What inquiries are you able to help with in this ticket type?',
        options: { A: 'Development Inquiries', B: 'General Questions', C: 'Role issues', D: 'Resignations' },
        answer: 'B'
    },
    {
        question: 'A user opens a **General Support** ticket to report an LR-HR staff. What is the correct course of action?',
        options: { A: 'Redirect them to a Human Resources ticket', B: 'Abandon the ticket', C: 'Ban the user', D: 'Try to punish the LR-HR being reported' },
        answer: 'A'
    },
    {
        question: 'What administrative privilege does a **High Rank** receive?',
        options: { A: 'Pban', B: 'Btools', C: 'Server Shutdown', D: 'Ban' },
        answer: 'D'
    },
    {
        question: 'What is the *consequence* of misusing the **ban** command?',
        options: { A: 'Strike', B: 'Termination', C: 'Demotion', D: 'Pban' },
        answer: 'B'
    }
];

const MOD_BASIC_SECTIONS = [
    {
        title: '<:emoji_1:1464065515579248854> Welcome to Moderation!',
        content: `Hello, and congratulations on passing your application and joining our Moderation Department! During this period, you will receive the trial moderator role as you undergo your mentorship.\n\nThis trial was designed to provide a clear explanation of our policies, expectations, procedures, and logging requirements. If you have any questions at any time, do not hesitate to ask.\n\nWe will now send a series of messages covering everything needed to become an excellent moderator. If you fail your trial you will receive only *one* opportunity to retake it. If you fail twice, you will be removed from the department.\n\nThis trial will be open until you achieve the rank of moderator.`
    },
    {
        title: '<:emoji_1:1464065515579248854> Rules & Procedures',
        content: `A moderator's main responsibility is to enforce and uphold all rules found within https://discord.com/channels/1370892833182974035/1370946530894413824. When moderating, you should do so fairly, professionally, and respectfully, as this helps keep our community safe and welcoming for everyone.\n\nAll actions should follow the guidelines listed below. Consistency and sound judgment are crucial when handling situations within the server.\n\n> [Kavià Cafe Rules](https://docs.google.com/spreadsheets/d/1cK-QcY_UXiFTCF8IQXlzCQqnz2uklMdHpEDR99oesm0/edit?usp=sharing)\n\nPlease ensure you are familiar with these rules and review the document periodically to stay informed. If you are ever unsure about what action to take, do not hesitate to contact a member of moderation leadership.`
    },
    {
        title: '<:emoji_1:1464065515579248854> Behavioral Expectations',
        content: `As a moderator, you don't just enforce rules; you're also expected to *follow* them yourself. Your behavior sets the tone for the rest of the server and demonstrates what is acceptable and what is not.\n\n**Prohibited actions as a moderator:**\n• **Swearing**\n• **Mean-spirited jokes**\n• **Mentions of real-life tragedies in inappropriate contexts**\n• **Disrespect & Drama**\n• **Rank abuse — e.g., threatening members with false punishment**\n\nWhile this list isn't everything, we expect you to use **common sense** to determine what's acceptable. If you think it might cause trouble, don't do it. Failure to do so may result in a strike from leadership.`
    }
];

const MOD_BASIC_QUIZ = [
    {
        question: 'What is a moderator\'s main responsibility?',
        options: { A: 'Welcoming new members', B: 'Enforce and uphold all server rules', C: 'Managing server channels', D: 'Organizing events' },
        answer: 'B'
    },
    {
        question: 'If you are unsure about what action to take in a situation, what should you do?',
        options: { A: 'Take action anyway', B: 'Ignore the situation', C: 'Contact a member of moderation leadership', D: 'Ask a regular member' },
        answer: 'C'
    },
    {
        question: 'Which of the following is a **prohibited action** as a moderator?',
        options: { A: 'Enforcing rules fairly', B: 'Swearing in chat', C: 'Logging moderation actions', D: 'Asking for help' },
        answer: 'B'
    },
    {
        question: 'How many times can you retake the trial if you fail?',
        options: { A: 'Three times', B: 'Unlimited', C: 'Once', D: 'You cannot retake it' },
        answer: 'C'
    },
    {
        question: '**True or False** — Moderators are expected to follow the same rules as regular members.',
        options: { A: 'True', B: 'False', C: null, D: null },
        answer: 'A'
    },
    {
        question: 'What three qualities should you demonstrate when moderating?',
        options: { A: 'Speed, strictness, and authority', B: 'Fairly, professionally, and respectfully', C: 'Quickly, quietly, and firmly', D: 'Boldly, clearly, and strictly' },
        answer: 'B'
    },
    {
        question: 'What should you do if you think an action might cause trouble?',
        options: { A: 'Do it anyway if you think it\'s right', B: 'Ask a regular member for advice', C: 'Don\'t do it', D: 'Wait and see what happens' },
        answer: 'C'
    },
    {
        question: '**True or False** — Rank abuse, such as threatening members with false punishment, is permitted.',
        options: { A: 'True', B: 'False', C: null, D: null },
        answer: 'B'
    }
];

const HR_BASIC_SECTIONS = [
    {
        title: '▶️ Human Resources Training',
        content: `👋 Welcome to the Human Resources team! Now that you've passed your application, you will undergo a trial period.\n\nOnce you pass this trial, you will move up to become an **official Human Resources Officer.**\n\n👓 You will receive a series of messages. You are expected to **read** and **understand** the information inside of them.\n\n❌ If you fail this trial, you will be given **one** chance to retake it. If you don't pass the extra chance, you will be **removed** from the department.`
    },
    {
        title: '👉 Purpose and Expectations',
        content: `📊 As a member of Human Resources, you are responsible for overseeing the overall quality, productivity, and performance of the lower staff team here at Kavià.\n\n🗂️ This includes but is not limited to promotions, demotions, strikes, terminations, and blacklists.\n\n✅ Another duty of yours is to host sessions and trainings.`
    },
    {
        title: '🧠 Session Information',
        content: `Please read both of these documents to become familiar with shift and training procedures.\n\n> 📄 [Shift Guide](https://docs.google.com/document/d/12MhP5KnwSqvpiP7w6l7iqgFuJwWkoMNpKYQCdtp3vfA/edit?usp=drivesdk)\n> 📄 [Training Guide](https://docs.google.com/document/d/10UZgkW6gdaoOSvN3pxFjaQOK3N7b9KqO0AMpysZLlhk/edit?usp=drivesdk)`
    },
    {
        title: '‼️ Prohibited Actions',
        content: `The following actions are strictly prohibited as a Human Resources member:\n\n• **Admin Abuse**\n• **Disrespect**\n• **Swearing**\n• **Mini-modding**\n• **Free Ranking**\n\nThis list is only a small idea of the rules. We expect you to use **common sense** when judging what's right and wrong.`
    },
    {
        title: '🛠️ Utilities',
        content: `**Promotions:**\n📈 As a HRD member, you are allowed to promote members in MR. You may **NOT** promote MR → HR.\n✋ If you want to promote a user, use <#1434560386861891727> and wait for HRD leadership to accept/decline.\n❌ If you promote someone without authorization, you will be striked and the user will be demoted back to their original rank.\n✅ If your promotion is accepted, use <#1462475668506808330> to send the user a promotion notice in DMs.\n📣 After that, announce it in **Staffing Announcements** in the main server using the first promotion format here → <#1462949099207786638>.\n\n**Disciplinary:**\nNo matter the type of discipline you are distributing, there is a procedure.\n\n> ❌ **Strike**\nMake sure to use <#1434560470156841090> to request a strike unless assigned to you by the Human Resources Lead. When giving a strike, use <#1462475668506808330> and fill out the information. Afterwards, log it in <#1462941722395934834>.\n\n> 📉 **Demotion**\nYou also need to request a demotion in <#1434560470156841090> unless assigned to you by the Human Resources Lead. When demoting a user, use <#1462475668506808330>. Use the /Terminate command but be sure to clarify that they are being demoted. Log it in <#1462941767656804573>.\n\n> 🔥/⚫ **Termination/Blacklist**\nAfter 2 demotions, a user may be terminated or blacklisted. Only blacklist a user for severe infractions. Request it first in <#1434560470156841090>. Afterwards, use <#1462475668506808330> with /terminate or /blacklist. Log it in <#1462942009164562463> or <#1462942147111292948>.`
    },
    {
        title: '🔢 Weekly Quota',
        content: `Every week, Human Resources members are expected to complete the quota.\n\n🔄 Since quota may change, the weekly quota will be sent out by Human Resources leadership in <#1482427067608862820>.\n\n📖 You are now ready for your test! You are free to use <#1434559110484856903> or any of the guides, but you **cannot ask for help**.`
    }
];

const HR_BASIC_QUIZ = [
    {
        question: 'What is the purpose of the Human Resources Department?',
        options: { A: 'To free rank my friends', B: 'To oversee lower ranked staff\'s quality and performance', C: 'To flex my rank on others', D: 'To bring MR members to an HR rank' },
        answer: 'B'
    },
    {
        question: 'What must you do first before sending out a punishment?',
        options: { A: 'Request it for Human Resources leadership to review', B: 'I don\'t have to do anything, just punish them', C: 'Ask chat what to do', D: 'Pass it on to someone else' },
        answer: 'A'
    },
    {
        question: 'What do you do after promoting or punishing a staff member?',
        options: { A: 'Nothing', B: 'Tell everyone in chat', C: 'Log it in the appropriate channel', D: 'Tell leadership to deal with it' },
        answer: 'C'
    },
    {
        question: 'How many demotions lead to a termination?',
        options: { A: '2', B: '6', C: '1', D: '4' },
        answer: 'A'
    },
    {
        question: 'Where can you find the weekly quota?',
        options: { A: 'In the guide', B: 'Asking a leadership member', C: 'In announcements', D: 'In the quota channel' },
        answer: 'D'
    },
    {
        question: 'What should you do if a staff member has an inappropriate avatar and refuses to change?',
        options: { A: 'Ban them', B: 'Strike them', C: 'Blacklist them', D: 'Tell a leadership member' },
        answer: 'B'
    },
    {
        question: 'Someone opens a Human Resources ticket to report a staff member committing minor admin abuse. What do you do?',
        options: { A: 'Ignore the ticket', B: 'Terminate them', C: 'Ban the person who made the ticket', D: 'Strike the staff if proof is valid' },
        answer: 'D'
    }
];

const activeSessions = new Map();

function getTrainingConfig(department, training) {
    if (OTHER_DEPTS.includes(department)) return { sections: null, quiz: null, notSetup: true };

    if (training === 'Basic Training') {
        if (department === 'Mod') return { sections: MOD_BASIC_SECTIONS, quiz: MOD_BASIC_QUIZ, passScore: 6, notSetup: false };
        if (department === 'Human Resources') return { sections: HR_BASIC_SECTIONS, quiz: HR_BASIC_QUIZ, passScore: 5, notSetup: false };
        return { sections: null, quiz: null, notSetup: true };
    }

    if (training === 'Intro to Mentorship') {
        return { sections: INTRO_TO_MENTORSHIP_SECTIONS, quiz: INTRO_TO_MENTORSHIP_QUIZ, passScore: 3, notSetup: false };
    }

    return { sections: null, quiz: null, notSetup: true };
}

function getSectionEmbed(section, index, total, department, training) {
    return new EmbedBuilder()
        .setTitle(section.title)
        .setDescription(section.content)
        .setColor(0x3498DB)
        .setFooter({ text: `Section ${index + 1} of ${total} • ${department} — ${training}` })
        .setTimestamp();
}

function getSectionButtons(userId, sectionIndex) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`st_done_${userId}_${sectionIndex}`)
            .setLabel('✅ Done')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`st_help_${userId}_${sectionIndex}`)
            .setLabel('🆘 I Need Help')
            .setStyle(ButtonStyle.Danger)
    );
}

function getQuizEmbed(q, questionIndex, score, total, department, training) {
    const options = Object.entries(q.options)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `**${k})** ${v}`)
        .join('\n');
    return new EmbedBuilder()
        .setTitle(`📝 Quiz — Question ${questionIndex + 1} of ${total}`)
        .setDescription(`${q.question}\n\n${options}`)
        .setColor(0x9B59B6)
        .setFooter({ text: `Current Score: ${score}/${questionIndex} • ${department} — ${training}` })
        .setTimestamp();
}

function getQuizButtons(userId, questionIndex, q) {
    const validOptions = Object.entries(q.options).filter(([, v]) => v !== null);
    const buttons = validOptions.map(([key]) =>
        new ButtonBuilder()
            .setCustomId(`st_quiz_${key}_${userId}_${questionIndex}`)
            .setLabel(key)
            .setStyle(ButtonStyle.Primary)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
    activeSessions,

    data: new SlashCommandBuilder()
        .setName('starttraining')
        .setDescription('Start a training session for a user')
        .addStringOption(option =>
            option.setName('department').setDescription('Department').setRequired(true).addChoices(...ALL_DEPT_CHOICES))
        .addStringOption(option =>
            option.setName('training').setDescription('Training to give').setRequired(true).addChoices(...TRAINING_CHOICES))
        .addUserOption(option =>
            option.setName('member').setDescription('Member to train').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const training = interaction.options.getString('training');
            const member = interaction.options.getUser('member');

            if (OTHER_DEPTS.includes(department)) {
                return interaction.editReply({ content: `❌ **${department}** does not have any trainings set up yet.` });
            }

            const deptConfig = TRAINING_DEPTS[department];
            if (!deptConfig) return interaction.editReply({ content: `❌ Department config not found.` });

            const deptGuild = await client.guilds.fetch(deptConfig.serverId);
            const deptMember = await deptGuild.members.fetch(interaction.user.id).catch(() => null);
            if (!deptMember || !deptMember.roles.cache.has(deptConfig.roleId)) {
                return interaction.editReply({ content: `❌ You do not have permission to give trainings in the **${department}** department.` });
            }

            const trainingConfig = getTrainingConfig(department, training);
            if (trainingConfig.notSetup) {
                return interaction.editReply({ content: `❌ **${training}** is not set up yet for **${department}**.` });
            }

            if (training === 'Basic Training' && (department === 'Mod' || department === 'Human Resources')) {
                const record = await CompletedTrainings.findById(member.id);
                const requiredTraining = `Intro to Mentorship — ${department}`;
                if (!record || !record.completedTrainings.includes(requiredTraining)) {
                    return interaction.editReply({ content: `❌ **${member.tag}** must complete **Intro to Mentorship** for the **${department}** department before taking Basic Training.` });
                }
            }

            if (activeSessions.has(member.id)) {
                return interaction.editReply({ content: `❌ **${member.tag}** already has an active training session.` });
            }

            const sessionData = {
                staffId: interaction.user.id,
                staffTag: interaction.user.tag,
                department,
                training,
                deptConfig,
                trainingConfig,
                section: 0,
                phase: 'sections',
                score: 0,
                quizIndex: 0,
                locked: false,
                awaitingAgeVerif: false,
                lastAgeVerifContent: null,
                ageVerifLogMessageId: null,
                ageVerifLogChannelId: null,
                ageVerifRepingTimeout: null,
                client
            };

            activeSessions.set(member.id, sessionData);

            try {
                const isAgeVerif = training === 'Intro to Mentorship' && sessionData.section === 1;
                const embed = getSectionEmbed(trainingConfig.sections[0], 0, trainingConfig.sections.length, department, training);

                if (isAgeVerif) {
                    await member.send({ embeds: [embed] });
                    sessionData.awaitingAgeVerif = true;
                } else {
                    const buttons = getSectionButtons(member.id, 0);
                    await member.send({ embeds: [embed], components: [buttons] });
                }

                await interaction.editReply({ content: `✅ Training started for **${member.tag}**! Sections are being sent to their DMs.` });

                const logChannel = await client.channels.fetch(deptConfig.logChannelId);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('📚 Training Session Started')
                                .setColor(0x3498DB)
                                .addFields(
                                    { name: '👤 Trainee', value: `${member.tag} (${member.id})` },
                                    { name: '🏢 Department', value: department },
                                    { name: '📖 Training', value: training },
                                    { name: '👮 Started By', value: interaction.user.tag }
                                )
                                .setTimestamp()
                        ]
                    });
                }

            } catch (err) {
                activeSessions.delete(member.id);
                return interaction.editReply({ content: `❌ Could not DM **${member.tag}**. They may have DMs closed.` });
            }

        } catch (err) {
            console.error('Error in /starttraining:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    },

    getSectionEmbed,
    getSectionButtons,
    getQuizEmbed,
    getQuizButtons,
    MOD_BASIC_SECTIONS,
    MOD_BASIC_QUIZ,
    HR_BASIC_SECTIONS,
    HR_BASIC_QUIZ,
    INTRO_TO_MENTORSHIP_SECTIONS,
    INTRO_TO_MENTORSHIP_QUIZ,
    TRAINING_DEPTS,
    getTrainingConfig
};
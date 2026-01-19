require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Path to the staffDiscipline JSON
const STAFF_FILE = path.join(__dirname, 'staffDiscipline.json');

// Ensure the staffDiscipline.json file exists
if (!fs.existsSync(STAFF_FILE)) {
    fs.writeFileSync(STAFF_FILE, JSON.stringify({}, null, 4));
    console.log('✅ Created staffDiscipline.json file.');
}

// Load or initialize the in-memory cache
let staffDisciplineCache = {};
try {
    staffDisciplineCache = JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8'));
    console.log('✅ Loaded staffDiscipline.json into cache.');
} catch (err) {
    console.error('❌ Failed to load staffDiscipline.json:', err);
}

// Create client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent // Required to read DM messages
    ],
    partials: ['CHANNEL'] // Needed for DMs
});

// Make cache available to commands
client.staffDisciplineCache = staffDisciplineCache;

// Command collection
client.commands = new Collection();

// Load all commands
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (!command.data || !command.execute) continue;
    client.commands.set(command.data.name, command);
    console.log(`Loaded command: ${command.data.name}`);
}

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`❌ Command error [/${interaction.commandName}]`, error);

        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: `❌ Error running command.`,
                    ephemeral: true
                });
            } catch (err) {
                console.error('Failed to send error reply:', err);
            }
        }
    }
});

// ----------- DM Reply Logger with reaction -----------
client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignore bot messages
    if (message.channel.type !== 1) return; // Only DMs

    const logChannelId = '1462580398935642144';
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

    // React to the user's message with a ✅
    try {
        await message.react('✅');
    } catch (err) {
        console.error('Failed to react to user DM:', err);
    }

    // Build log embed for user response
    const userReplyEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('💬 **DM Received**')
        .addFields(
            {
                name: '📤 From (User)',
                value: `${message.author.tag} (${message.author.id})`
            },
            {
                name: '📥 To (Bot)',
                value: `${client.user.tag}`
            },
            {
                name: '📝 Message',
                value: message.content
            },
            {
                name: '🕒 Date & Time',
                value: timestamp
            }
        )
        .setFooter({ text: 'Kavia Cafe • DM Logs' });

    try {
        const logChannel = await client.channels.fetch(logChannelId);
        if (logChannel) {
            await logChannel.send({ embeds: [userReplyEmbed] });
        }
    } catch (err) {
        console.error('Error logging user DM:', err);
    }
});

// Save cache to file on exit
function saveStaffDiscipline() {
    fs.writeFileSync(STAFF_FILE, JSON.stringify(client.staffDisciplineCache, null, 4));
    console.log('✅ staffDiscipline.json saved.');
}

process.on('exit', saveStaffDiscipline);
process.on('SIGINT', () => { saveStaffDiscipline(); process.exit(); });
process.on('SIGTERM', () => { saveStaffDiscipline(); process.exit(); });

client.login(process.env.TOKEN);
console.log('✅ Bot started successfully!');
console.log('BOT PROCESS ID:', process.pid);

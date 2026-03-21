require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const { connectDB } = require('./db');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: ['CHANNEL']
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
const cmds = [];
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (!command.data || !command.execute) continue;
    client.commands.set(command.data.name, command);
    cmds.push(command.data.toJSON());
    console.log(`Loaded command: ${command.data.name}`);
}

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
                await interaction.reply({ content: `❌ Error running command.`, ephemeral: true });
            } catch (err) {
                console.error('Failed to send error reply:', err);
            }
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;

    const logChannelId = '1462580398935642144';
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

    try { await message.react('✅'); } catch (err) {
        console.error('Failed to react to user DM:', err);
    }

    const userReplyEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('💬 **DM Received**')
        .addFields(
            { name: '📤 From (User)', value: `${message.author.tag} (${message.author.id})` },
            { name: '📥 To (Bot)', value: `${client.user.tag}` },
            { name: '📝 Message', value: message.content },
            { name: '🕒 Date & Time', value: timestamp }
        )
        .setFooter({ text: 'Kavia Cafe • DM Logs' });

    try {
        const logChannel = await client.channels.fetch(logChannelId);
        if (logChannel) await logChannel.send({ embeds: [userReplyEmbed] });
    } catch (err) {
        console.error('Error logging user DM:', err);
    }
});

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    // Clear global commands first
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    console.log('✅ Cleared global commands');

    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: [] }
            );
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: cmds }
            );
            console.log(`✅ Commands registered in guild: ${guild.name}`);
        } catch (err) {
            console.error(`❌ Failed to register commands in guild ${guild.name}:`, err);
        }
    }
});

client.on('guildCreate', async guild => {
    console.log(`✅ Joined new guild: ${guild.name}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: cmds }
        );
        console.log(`✅ Commands registered in new guild: ${guild.name}`);
    } catch (err) {
        console.error(`❌ Failed to register commands in new guild ${guild.name}:`, err);
    }
});

connectDB().then(() => {
    client.login(process.env.TOKEN);
    console.log('✅ Bot started successfully!');
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
});
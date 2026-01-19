require('dotenv').config();
const fs = require('fs');
const { REST, Routes } = require('discord.js');

const CLIENT_ID = process.env.CLIENT_ID; // Your bot application ID
const GUILD_ID = '1434556801096876034'; // Your server ID
const TOKEN = process.env.TOKEN;

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Load all command files
const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded command: ${command.data.name}`);
    } else {
        console.log(`⚠️ Skipped file (no data): ${file}`);
    }
}

(async () => {
    try {
        console.log('🗑️ Deleting all guild commands...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [] }
        );
        console.log('✅ All old guild commands deleted!');

        console.log('🚀 Registering new guild commands...');
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log(`✅ Registered ${data.length} commands successfully!`);
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();

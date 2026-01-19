require('dotenv').config();
const { REST, Routes } = require('discord.js');

const GUILD_ID = '1434556801096876034'; // your server ID
const CLIENT_ID = process.env.CLIENT_ID;
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🗑️ Deleting all slash commands in the guild...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: [] } // empty array = delete all commands
    );
    console.log('✅ All slash commands deleted!');
  } catch (err) {
    console.error(err);
  }
})();

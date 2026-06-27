const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Birthday } = require('../db');

const BIRTHDAY_CHANNEL_ID = '1493773047323164792';
const BIRTHDAY_GUILD_ID = '1370892833182974035';

const MONTHS = [
    { name: 'January', value: '1' }, { name: 'February', value: '2' }, { name: 'March', value: '3' },
    { name: 'April', value: '4' }, { name: 'May', value: '5' }, { name: 'June', value: '6' },
    { name: 'July', value: '7' }, { name: 'August', value: '8' }, { name: 'September', value: '9' },
    { name: 'October', value: '10' }, { name: 'November', value: '11' }, { name: 'December', value: '12' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Set or view your birthday')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Set or remove your birthday')
                .setRequired(true)
                .addChoices(
                    { name: 'Set', value: 'set' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'View', value: 'view' }
                ))
        .addStringOption(option =>
            option.setName('month')
                .setDescription('Birth month (required if setting)')
                .setRequired(false)
                .addChoices(...MONTHS))
        .addIntegerOption(option =>
            option.setName('day')
                .setDescription('Birth day (1-31, required if setting)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(31)),

    async execute(interaction, client) {
        const action = interaction.options.getString('action');

        if (action === 'set') {
            const month = interaction.options.getString('month');
            const day = interaction.options.getInteger('day');

            if (!month || !day) {
                return interaction.reply({ content: '❌ You must provide both a month and day to set your birthday.', ephemeral: true });
            }

            const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            if (day > daysInMonth[parseInt(month) - 1]) {
                return interaction.reply({ content: '❌ That day doesn\'t exist in the selected month.', ephemeral: true });
            }

            try {
                await Birthday.findByIdAndUpdate(
                    interaction.user.id,
                    { _id: interaction.user.id, month: parseInt(month), day, lastAnnouncedYear: null },
                    { upsert: true }
                );

                const monthName = MONTHS.find(m => m.value === month).name;
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('🎂 Birthday Set!')
                        .setDescription(`Your birthday has been set to **${monthName} ${day}**.\n\nWe'll celebrate it with you in <#${BIRTHDAY_CHANNEL_ID}> when it comes around!`)
                        .setColor(0xF39C12)
                        .setTimestamp()],
                    ephemeral: true
                });
            } catch (err) {
                console.error('Error setting birthday:', err);
                await interaction.reply({ content: '❌ Error setting your birthday.', ephemeral: true });
            }
            return;
        }

        if (action === 'remove') {
            try {
                await Birthday.findByIdAndDelete(interaction.user.id);
                await interaction.reply({ content: '✅ Your birthday has been removed.', ephemeral: true });
            } catch (err) {
                console.error('Error removing birthday:', err);
                await interaction.reply({ content: '❌ Error removing your birthday.', ephemeral: true });
            }
            return;
        }

        if (action === 'view') {
            try {
                const record = await Birthday.findById(interaction.user.id);
                if (!record) {
                    return interaction.reply({ content: '📭 You haven\'t set a birthday yet. Use `/birthday set` to add one!', ephemeral: true });
                }
                const monthName = MONTHS.find(m => m.value === String(record.month)).name;
                await interaction.reply({ content: `🎂 Your birthday is set to **${monthName} ${record.day}**.`, ephemeral: true });
            } catch (err) {
                console.error('Error viewing birthday:', err);
                await interaction.reply({ content: '❌ Error viewing your birthday.', ephemeral: true });
            }
            return;
        }
    },

    BIRTHDAY_CHANNEL_ID,
    BIRTHDAY_GUILD_ID
};
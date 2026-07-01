const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ALLOWED_USER_ID = '576954029016481802';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trollreview')
        .setDescription('👻 Owner only troll command')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Who to troll')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('How many fake 1-star reviews to add')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Add or reset fake reviews')
                .setRequired(true)
                .addChoices(
                    { name: 'Add fake bad reviews', value: 'add' },
                    { name: 'Reset back to real reviews', value: 'reset' }
                )),

    async execute(interaction, client) {
        if (interaction.user.id !== ALLOWED_USER_ID) {
            return interaction.reply({ content: '❌ Nice try.', ephemeral: true });
        }

        const target = interaction.options.getUser('target');
        const count = interaction.options.getInteger('count');
        const action = interaction.options.getString('action');

        if (!client.trollReviews) client.trollReviews = new Map();

        if (action === 'add') {
            client.trollReviews.set(target.id, count);

            try {
                await target.send({
                    content: `🤡🤡🤡 AHAHAHAHAHA LOSER!!! You just got **${count}** 1-star reviews!!! DO BETTER LOSER!!! 🤡🤡🤡\n\nYour ticket rating is now absolutely cooked 💀 Maybe try being better at your job next time??? 😂😂😂`
                });
            } catch {}

            return interaction.reply({
                content: `✅ Added **${count}** fake 1-star reviews to **${target.tag}**. They've been notified 🤡`,
                ephemeral: true
            });
        }

        if (action === 'reset') {
            const had = client.trollReviews.get(target.id) || 0;
            client.trollReviews.delete(target.id);

            try {
                await target.send({
                    content: `😌 Okay okay... I've removed your **${had}** fake bad reviews. You're back to normal. For now. 👀`
                });
            } catch {}

            return interaction.reply({
                content: `✅ Reset fake reviews for **${target.tag}**. The ${had} fake reviews are gone.`,
                ephemeral: true
            });
        }
    }
};
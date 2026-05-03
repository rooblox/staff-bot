const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Review } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reviews')
        .setDescription('View reviews for a staff member')
        .addUserOption(option =>
            option.setName('staff').setDescription('Staff member to view reviews for').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});

        try {
            const staff = interaction.options.getUser('staff');
            const reviews = await Review.find({ staffId: staff.id });

            if (!reviews || reviews.length === 0) {
                return interaction.editReply({ content: `❌ **${staff.tag}** has no reviews yet.` });
            }

            const total = reviews.length;
            const avg = (reviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1);
            const fiveStars = reviews.filter(r => r.rating === 5).length;
            const fourStars = reviews.filter(r => r.rating === 4).length;
            const threeStars = reviews.filter(r => r.rating === 3).length;
            const twoStars = reviews.filter(r => r.rating === 2).length;
            const oneStar = reviews.filter(r => r.rating === 1).length;

            const starsDisplay = (count, total) => {
                const pct = total > 0 ? Math.round((count / total) * 10) : 0;
                return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${count}`;
            };

            const embed = new EmbedBuilder()
                .setTitle(`⭐ Reviews — ${staff.tag}`)
                .setColor(0xF39C12)
                .setThumbnail(staff.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '⭐ Average Rating', value: `**${avg}/5** from **${total}** review${total !== 1 ? 's' : ''}`, inline: false },
                    { name: '5 ⭐', value: starsDisplay(fiveStars, total), inline: false },
                    { name: '4 ⭐', value: starsDisplay(fourStars, total), inline: false },
                    { name: '3 ⭐', value: starsDisplay(threeStars, total), inline: false },
                    { name: '2 ⭐', value: starsDisplay(twoStars, total), inline: false },
                    { name: '1 ⭐', value: starsDisplay(oneStar, total), inline: false }
                )
                .setFooter({ text: 'Kavià Café • Staff Reviews' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /reviews:', err);
            try { await interaction.editReply({ content: '❌ Error fetching reviews.' }); } catch {}
        }
    }
};
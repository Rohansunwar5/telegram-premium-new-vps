export function extractLinks(text: string): string[] {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const links = text.match(urlPattern);
    return links ? links : [];
}

export function generateMessageStatistics(messages: any[], triggerWords: string[]) {
    const triggerFrequency: Record<string, { count: number; message_ids: number[] }> = {};
    for (const word of triggerWords) {
        triggerFrequency[word] = { count: 0, message_ids: [] };
    }
    
    const frequencyHourly: number[] = Array.from({ length: 24 }, () => 0);
    const frequencyWeekday: Record<string, number> = {};
    const frequencyUser: Record<string, number> = {};
    const links: any[] = [];

    // Helper days map
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    for (const message of messages) {
        try {
            const time = new Date(message.timestamp_raw || message.timestamp);
            
            if (!isNaN(time.getTime())) {
                frequencyHourly[time.getHours()] += 1;
                const dayName = days[time.getDay()];
                frequencyWeekday[dayName] = (frequencyWeekday[dayName] || 0) + 1;
            }

            const sender = message.username || message.sender || "null";
            const text = message.text || message.content || "";

            const messagePart = {
                sender: sender,
                message_id: message.message_id,
                text: text,
                timestamp: Math.floor(time.getTime() / 1000)
            };

            frequencyUser[sender] = (frequencyUser[sender] || 0) + 1;

            for (const word of triggerWords) {
                if (text.toLowerCase().includes(word.toLowerCase())) {
                    triggerFrequency[word].count += 1;
                    triggerFrequency[word].message_ids.push(messagePart.message_id);
                }
            }

            const extractedLinks = extractLinks(text);
            if (extractedLinks && extractedLinks.length > 0) {
                links.push({
                    message_id: messagePart.message_id,
                    links: extractedLinks
                });
            }
        } catch (e) {
            console.error(e);
        }
    }

    return {
        trigger_frequency: triggerFrequency,
        frequency_hourly: frequencyHourly,
        frequency_weekday: frequencyWeekday,
        frequency_user: frequencyUser,
        links: links,
    };
}

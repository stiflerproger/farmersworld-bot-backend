export const mHello = () => `
👋 Добро пожаловать в Экосистему WAX ботов 👋

Мы создаём самые выгодные скрипты для заработка на WAX DApps
💻 - Наши боты работают
💵 - Вы зарабатываете
`;

export const mProfile = (balance: number) => `
💵 На Вашем балансе: $${(balance / 100).toFixed(2)}
`;

export const mDeposit = (account: string, memo: string, min?: number) => `
Чтобы пополнить баланс, отправьте <b>WAX</b> токены по реквизитам:

адрес: <code>${account}</code>
memo: <code>${memo}</code>

${min ? `<i>минимальный депозит ${min} WAX</i>` : ''}
`;
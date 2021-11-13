export const mHello = () => `
👋 Добро пожаловать в Экосистему WAX ботов 👋

Мы создаём самые выгодные скрипты для заработка на WAX DApps
💻 - Наши боты работают
💵 - Вы зарабатываете

Если вы здесь впервые, то настоятельно рекомендуем ознакомиться с описанием нашей системы, по кнопке "📚 FAQ" на клавиатуре
`;

export const mProfile = (data: { balance: number }) => `
💵 На Вашем балансе: $${(data.balance / 100).toFixed(2)}
`;

export const mDeposit = (data: {
  account: string;
  memo: string;
  min?: number;
}) => `
Чтобы пополнить баланс, отправьте <b>WAX</b> токены по реквизитам:

адрес: <code>${data.account}</code>
memo: <code>${data.memo}</code>

${data.min ? `<i>минимальный депозит ${data.min} WAX</i>` : ''}
`;

export const mBalanceAdded = (data: { amount: number; total: number }) => `
💵 Успешное пополнение баланса на <b>$${data.amount / 100}</b> 💵

Текущий баланс: <b>$${data.total / 100}</b>
`;

export const mBots = (data: { newBotPrice: number }) => ` 
🤖 Список ваших ботов в экосистеме

<code>Добавление нового бота стоит: $${data.newBotPrice / 100}</code> 
`;

import { uniqueNamesGenerator, names, starWars } from 'unique-names-generator';

export function getRandomNickname() {
  const dictionaries = [
    [names],
    [names],
    [names],
    [names],
    [names],
    [starWars],
  ];

  while (true) {
    const nickname = getNickname();

    if (/^[1-5a-z]{4,12}$/i.test(nickname)) {
      return nickname;
    }
  }

  function getNickname() {
    return uniqueNamesGenerator({
      dictionaries:
        dictionaries[Math.floor(Math.random() * dictionaries.length)],
    });
  }
}

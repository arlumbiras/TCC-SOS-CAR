# SOS-CAR Mobile

Aplicativo Android em React Native com Expo, reutilizando a API Node.js da pasta `server/`.

## Rodar no emulador Android

Na raiz do projeto:

```powershell
npm start
```

Em outro terminal:

```powershell
Set-Location mobile
npm start
```

Abra o projeto no Expo Go ou pressione `a` com um emulador Android disponível. O padrão `http://10.0.2.2:3000` aponta para o backend rodando no computador.

Para o emulador, inicie o backend em HTTP local com `$env:DEV_HTTP='true'; npm start`. Para aparelho físico, crie `mobile/.env` a partir de `.env.example` e troque `EXPO_PUBLIC_API_URL` pelo endereço acessível na rede local. O backend deve estar iniciado com `npm start`.

## Fluxos disponíveis

- Login e cadastro de cliente ou prestador.
- Recuperação e redefinição de senha por deep link `soscar://`.
- Cliente: seleção de categoria, localização GPS, abertura, acompanhamento, cancelamento e avaliação.
- Prestador: disponibilidade, lista de chamados próximos, aceite, chegada, conclusão, liberação, avaliações e histórico.
- Conta: edição de perfil e senha; histórico de chamados.
- Administração: login, estatísticas, categorias, aprovação de prestadores e moderação de chamados.
- Ajuda, Sobre, Termos de Uso e Privacidade.
- Mapa nativo com `react-native-maps` no acompanhamento de chamados.
- Sessão persistida no Android com AsyncStorage.

A API existente continua sendo a fonte das regras de negócio e dos dados.

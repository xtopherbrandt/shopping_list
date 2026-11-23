# Shopping List

Shows the family's **Alexa shopping list** sorted in the order you walk the store
(your grocery store), so you can shop top to bottom.

- Everyone keeps adding items by voice: "Alexa, add milk to my shopping list."
- Open the app on your phone: items are grouped by area and aisle in walking order.
- Tap an item to cross it off. Tap **⋯** to move it to the right aisle; the app remembers that for next time.
- Tap **Done shopping** at the end: crossed-off items are ticked off in Alexa too.
- If Alexa can't be reached, **Paste list** lets you add items by hand.

## How sorting works

`config/store-layout.json` lists every store area and aisle in walking order. Each
location has the words on its aisle sign and a list of `keywords`. An item goes to the
location whose longest keyword appears in its name (so "ice cream" goes to frozen, not
dairy). Anything with no match shows under **Not sorted yet** at the top.

When you move an item in the app, that choice is saved in `DATA_DIR/state.json` and
always wins over keywords.

To add aisle 4 and 5, or the deli and bakery, edit their entries in
`config/store-layout.json` and redeploy.

## How it reads Alexa

Amazon shut off its official shopping list API for outside apps in July 2024. This app
uses [alexa-remote2](https://github.com/Apollon77/alexa-remote), the open source library
behind the ioBroker and Home Assistant Alexa integrations, which signs in the way the
Alexa app does. It is unofficial, so an Amazon change can break it from time to time;
updating the library usually fixes it, and **Paste list** keeps working meanwhile.

## Run it locally

Needs Node 20 or newer.

```sh
npm install
npm test
npm start          # http://localhost:8080
```

### Connect Alexa (one time)

Run this on your own computer (it opens a sign-in page on `localhost`):

```sh
npm run alexa-login
```

Open http://localhost:3001, sign in to your Amazon.ca account (the one the Echo uses),
and approve any 2-step code. The script saves the sign-in to `data/alexa-cookie.json`
and prints a `fly secrets set ALEXA_COOKIE=...` command for the cloud server.
The server refreshes the sign-in by itself after that.

## Deploy to Fly.io

Fly.io runs it on a small machine that sleeps when nobody is using it, which normally
costs nothing or a few cents a month.

```sh
# once
brew install flyctl            # or see https://fly.io/docs/flyctl/install/
fly auth signup                # or: fly auth login
fly launch --no-deploy --copy-config --name <pick-a-name>
fly volumes create shopping_data --size 1 --region sea
fly secrets set APP_PASSCODE=<a family passcode>
fly secrets set ALEXA_COOKIE=<value printed by npm run alexa-login>

# each time the code or store layout changes
fly deploy
```

Then open `https://<your-app-name>.fly.dev` on each phone, enter the passcode, and use
"Add to Home Screen".

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_PASSCODE` | none | Family passcode. Set this for any public deployment. |
| `ALEXA_COOKIE` | none | Alexa sign-in from `npm run alexa-login`, used on first start. |
| `AMAZON_PAGE` | `amazon.ca` | Amazon site your Alexa account is on. |
| `AMAZON_BASE_PAGE` | `amazon.com` | Amazon site used for sign-in. Amazon.ca accounts sign in through amazon.com. |
| `AMAZON_LANGUAGE` | `en-US` | Language for the Amazon sign-in page. |
| `DATA_DIR` | `./data` | Where corrections and the Alexa sign-in are saved. |
| `PORT` | `8080` | Web server port. |
| `ALEXA_DEBUG` | off | Set to `1` to log Alexa library details. |

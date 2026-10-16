# Ultimate Hold'em

Ultimate Texas Hold'em you can play live with friends from anywhere. Runs entirely in the browser, so GitHub Pages can host it for free.

- 5 seats max, host can fill empty seats with computer players
- Trips and Pairs Bonus side bets, either or both
- Fresh single 52-card deck every hand
- Ante $10 to $500, side bets $5 to $100, play money

## Put it on GitHub Pages

1. Create a new public repo on GitHub, for example `ultimate-holdem`.
2. Upload `index.html`, `engine.js`, `app.js` and this README to the root of the repo.
3. Go to Settings > Pages. Under "Build and deployment" pick **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute the game is live at `https://<your-username>.github.io/ultimate-holdem/`.

## Playing with friends

1. Open the site, type your name, pick starting chips, hit **Open a table**.
2. Hit **Invite** to copy the link (or text the 5-letter table code).
3. Friends open the link, type a name, hit **Join**.
4. Everyone places bets and taps **Deal me in**. The hand deals once every connected player is ready, or the host taps **Deal now**.

Host controls: add computer players, remove a seat between hands, **Deal now**, and **Hurry up** (auto checks, or folds on the river, anyone still thinking).

## How it works

There is no server. The host's browser runs the table and deals the cards. Friends connect straight to the host over WebRTC using the free PeerJS lobby. Players only ever receive their own hole cards; the dealer's cards stay on the host until showdown.

Things to know:

- **The host has to keep the page open.** If the host closes or refreshes, the table ends.
- If a friend drops, their seat and chips are held. They reopen the invite link on the same device and land back in their seat. While away they auto check, or fold on the river.
- If the online lobby can't be reached, the host gets an offline table to play solo against computer players.
- Some strict networks (certain office Wi-Fi or mobile carriers) block direct peer connections. If one friend can never connect, add a TURN server to `PEER_OPTS` at the top of `app.js`.

## Rules used

- Ante and Blind are equal. Before the flop check or bet 3x/4x ante, after the flop check or bet 2x, on the river bet 1x or fold.
- Dealer needs a pair or better to open. If not, Ante pushes.
- Beat the dealer: Play pays 1 to 1, Ante 1 to 1, Blind per table (straight or better, otherwise push). Lose: all three lose. Tie: all push.
- Blind: Royal 500, Straight Flush 50, Quads 10, Full House 3, Flush 3 to 2, Straight 1 to 1.
- Trips (pays on your final hand even if you fold): Royal 50, Straight Flush 40, Quads 30, Full House 8, Flush 7, Straight 4, Trips 3.
- Pairs Bonus (your two cards): A-A 30, A-K suited 25, A-Q/A-J suited 20, A-K offsuit 15, K-K/Q-Q/J-J 10, A-Q/A-J offsuit 5, 10-10 thru 2-2 3.

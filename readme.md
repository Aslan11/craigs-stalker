# Craig's Stalker

Quick Node.JS Script for scraping CraigsList, storing the results in a Redis Stream and notifiying the user of new results since the last run

## Requirements:

- Node.js
- Redis > 5.X (Default: localhost, 6379)
- A craigslist URL which has your narrowed down search results ordered by "Newest"

## Install

 - clone repo
 - `cd craigs-stalker`
 - `npm i`

## Quick  Start

- Make sure Redis is running locally (or edit the script to point to your redis instance)
- Get your craigslist URL ready and enter it on line 19, remember to sort your results by "newest"
- `node scrape.js`
- Each time you scrape it should notify you of any new results should there be any

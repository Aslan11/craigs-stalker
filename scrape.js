// We'll be leveraging 3 node_modules in our script:
// Axios is a promised-based HTTP client
const axios = require('axios')
// Cheerio gives gives us jQuery like DOM traversal
const cheerio = require('cheerio')
// Redis allow us to connect to Redis, our favorite database
const redis = require('redis')

// Lets get scraping
console.log('')
console.log('Beginning Scraping')
const scrape = async () => {
  try {
    // Here we'll use Axios to grab a craiglist search that we're happy with
    // it's important that the craiglist search is ordered by date (&sort=date)
    // since we're focused on seeing what's new each time the script runs
    console.log('Request Data (HTTP/GET)')
    const { data } = await axios.get(
      'https://sacramento.craigslist.org/search/cta?query=bmw&purveyor=owner&sort=date&hasPic=1&bundleDuplicates=1&search_distance=150&postal=95630&min_price=500&max_price=5000&auto_transmission=1'
    );
    // We'll now load the data into cheerio so we can traverse the DOM
    const $ = cheerio.load(data);
    console.log('Data Received')
    // We'll also create a bucket for our posts to go into
    const results = [];

    // for each li.result-row in the dom (each post on CL)
    console.log('Starting to Parse Results')
    $('li.result-row').each((_idx, el) => {
      const result = cheerio.load($(el).html())
      // Grab Post Title
      const resultHeading = result('.result-heading > a').text()
      // Grab Post Link
      const resultLink = result('.result-heading > a').attr('href')
      // Grab Post Image Id's
      const resultImageIds = result('.result-image').attr('data-ids')
      // Pull out the cover image ID from resultImageIds
      const coverImageId = resultImageIds.substring(
        resultImageIds.indexOf(':') + 1,
        resultImageIds.indexOf(',')
      )
      // Create the resultCoverImageUrl leveraging the coverImageId
      const resultCoverImageUrl = 'https://images.craigslist.org/' + coverImageId + '_600x450.jpg'
      // Grab the Post Price
      const resultPrice = result('.result-meta .result-price').text()
      // Grab the distance from the zipcode specified in the initial GET
      const resultDistance = result('.maptag').text()
      const resultDateTime = result('.result-date').attr('datetime')
      // 2022-09-22 22:01 <- resultDateTime format, lets split this up
      // in order to generate a UNIX Timestamp that plays with Redis Streams
      const [dateComponents, timeComponents] = resultDateTime.split(' ')
      const [year, month, day] = dateComponents.split('-')
      const [hours,minutes] = timeComponents.split(':')
      // we subtract 1 from the month since 0 is January :)
      const date = new Date(year, month - 1, day, hours, minutes)
      const unixTimeStamp = Math.floor(date.getTime() / 1000)

      // Finally we'll stitch the data together into an object
      // that represents the result information that we care about
      const resultObject = {
        heading: resultHeading,
        link: resultLink,
        price: resultPrice,
        distance: resultDistance,
        dateTime: resultDateTime,
        img: resultCoverImageUrl,
        unixTimeStamp: unixTimeStamp
      }

      results.push(resultObject)
    })

    results.sort((a,b) => (a.unixTimeStamp > b.unixTimeStamp) ? 1 : ((b.unixTimeStamp > a.unixTimeStamp) ? -1 : 0))
    console.log('Finished Parsing Results')
    return results
  } catch (error) {
    throw error
  }
};

// Lets write a function that will handle pushing
// the scraped results into redis streams
const streamInput = async (results) => {
  // Create a Redis Client
  const client = redis.createClient()
  // Redis Client Error Handling
  client.on('error', (err) => console.log('Redis Client Error', err));
  // Initialize Connection
  await client.connect()
  console.log('Connected to Redis')

  // We need to keep track of the last record seen so we
  // know what's new since the last run
  let lastSeen = "0"
  // Check to see if we've seen something before,
  const streamExists = await client.exists('stream:craigslist:lastseen')
  if (streamExists == 1) {
    lastSeen = await client.get('stream:craigslist:lastseen')
  }
  console.log('Last Seen Timestamp: '+lastSeen.split('-')[0])
  // Iterate over results
  for (const result of results) {
    // if the result has a timestamp greater than the posting last seen,
    if (result.unixTimeStamp > parseInt(lastSeen.split('-')[0])) {
      // Add it to the stream
      await client.sendCommand(
        [
          'XADD',
          'stream:craigslist',
          'MAXLEN',
          '~',
          '50',
          result.unixTimeStamp.toString() + '-*',
          'heading',
          result.heading,
          'link',
          result.link,
          'price',
          result.price,
          'distance',
          result.distance,
          'dateTime',
          result.dateTime,
          'image',
          result.img
        ]
      )
    }
  }

  // Check to see what we've seen last
  const newLastSeen = await client.sendCommand(
    [
      'XREVRANGE',
      'stream:craigslist',
      '+',
      '-',
      'count',
      '1'
    ]
  )
  // If it's newer than what we've recorded as the last seen event,
  // grab the new results
  if (newLastSeen[0][0] !== lastSeen) {
    const newResults = await client.sendCommand (
      [
        'XREAD',
        'streams',
        'stream:craigslist',
        lastSeen,
      ]
    )
    // update the last seen for the next run
    await client.set('stream:craigslist:lastseen', newLastSeen[0][0])
    // return the new results
    console.log('New Results Found:')
    return newResults[0][1][0]
  } else {
    console.log('Last Seen Matches Latest - Nothing New Here')
    process.exit(0)
  }
}

scrape()
  .then(
    (results) => {
      streamInput(results)
        .then(
          (newResults) => {
            console.log(newResults)
            process.exit(0)
          }
        )
      }
    )
  .catch(
    (error) => {
      console.error(error)
      process.exit(1)
    }
  )

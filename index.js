#!/usr/bin/env node --harmony-async-await

let poll = require('promise-poll')
let notifier = require('node-notifier')
let request = require('request-promise')
let maps = require('@google/maps')
let _ = require('lodash')
let util = require('util')
let path = require('path')
let program = require('commander')
let debug = require('debug')
let moment = require('moment')

let d = {
  start: debug('start'),
  found: debug('found'),which
  range: debug('range'),
  transit: debug('transit')
}

program
  .version('0.0.1')
  .description('Notifies you if a Pokemon can be caught nearby')
  .option('-k, --key [key]', 'Google API key to use', 'AIzaSyAaq1WmRMW9q7qf3-milCeoaY8Jm6KUG58')
  .option('-l, --location [location]', 'Where you currently are to see if you can get there in time', '23 Heddon St, London')
  .parse(process.argv)

maps = maps.createClient({ key: program.key, Promise })
let pokemonById, pokemonByName;

async function getPokemonList() {

  let opts = {
    uri: 'https://londonpogomap.com/json/pokemon_list.json?ver8',
    headers: {
      'Referer': 'https://londonpogomap.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.95 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest'
    },
    json: true
  }

  let response = await request(opts)

  return Promise.resolve(response)
}

async function searchPokemon(mons) {

  let opts = {
    uri: 'https://londonpogomap.com/query2.php',
    qs: {
      'since': 0,
      'mons': mons.join(',')
    },
    headers: {
      'Referer': 'https://londonpogomap.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.95 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest'
    },
    json: true
  }

  let response = await request(opts)

  return Promise.resolve(response.pokemons)
}

/**
 * // mons has a lat and a lng property
 */
async function getTravelTimes(locations, mode) {

  let opts = {
    origins: program.location,
    destinations: locations,
    mode
  }

  let distance = await maps.distanceMatrix(opts).asPromise()

  // there will only be one row as we only have one origin
  let elements = distance.json.rows[0].elements
  let times = elements.map(el => el.duration.value)

  return Promise.resolve(times)
}

async function pokemonsFound(mons) {

  let transitTimes = await getTravelTimes(mons, 'transit')
  let walkingTimes = await getTravelTimes(mons, 'walking')
  let cyclingTimes = await getTravelTimes(mons, 'bicycling')

  mons = mons.map((mon, i) => {

    // Object for time comparison
    let times = {
      transit: transitTimes[i],
      walking: walkingTimes[i],
      cycling: cyclingTimes[i]
    }

    // Debug
    d.transit(monMessage({ mon, mode: 'transit', time: transitTimes[i] }))
    d.transit(monMessage({ mon, mode: 'walking', time: walkingTimes[i] }))
    d.transit(monMessage({ mon, mode: 'cycle', time: cyclingTimes[i] }))

    // Gets the key of the lowest time
    let mode = _.minBy(Object.keys(times), key => times[key])

    // Return mon with mode of travel and time required
    return {
      mon,
      mode,
      time: times[mode]
    }
  })

  mons = mons.filter(mon => {
    // Debug
    d.found(monMessage(mon))

    let arrival = Date.now() / 1000 + mon.time
    return arrival < mon.mon.despawn
  });

  return Promise.resolve(mons)
}

/**
 * e.g. Aerodactyl found 14 mins away by cycle, despawning in 13 minutes
 *
 * @param  {[type]} mon [description]
 * @return {[type]}     [description]
 */
function monMessage(mon) {

  let now = Date.now () / 1000
  let despawn = moment.duration(mon.mon.despawn - now, 'seconds')
  let arrival = moment.duration(mon.time, 'seconds')

  return `${pokemonById[mon.mon.pokemon_id].name} found ${arrival.humanize()} away by ${mon.mode}, despawing in ${despawn.humanize()}`
}

async function pokemonsInRange(mons) {

  mons.forEach((mon) => {

    let mins = Math.ceil(mon.time / 60);

    // Debug
    d.range(monMessage(mon))

    notifier.notify({
      title: pokemonById[mon.mon.pokemon_id].name,
      message: `${mins} mins by ${mon.mode}`,
      icon: path.join(__dirname, 'img', `${mon.mon.pokemon_id}.png`),
      sound: true,
      wait: true,
      open: `http://maps.google.com/maps?q=${mon.mon.lat},${mon.mon.lng}&zoom=14`
    })

  })

}

async function runSearch(mons, pokemonsFound, pokemonsInRange) {

  d.start(`Searching for ${mons.length} pokemons`)

  let found = await searchPokemon(mons)
  d.found(`${found.length} found`)

  let inRange = found.length ? await pokemonsFound(found) : []
  d.range(`${inRange.length} found in range`)

  pokemonsInRange(inRange)
}

async function run() {
  let pokemonList = await getPokemonList()

  pokemonByName = _.keyBy(pokemonList, 'name')
  pokemonById = _.keyBy(pokemonList, 'id')

  let mons = _.compact(program.args.map(mon => pokemonByName[mon] ? pokemonByName[mon].id : null))

  runSearch(mons, pokemonsFound, pokemonsInRange)
  setInterval(() => runSearch(mons, pokemonsFound, pokemonsInRange), 60000)
}

run()

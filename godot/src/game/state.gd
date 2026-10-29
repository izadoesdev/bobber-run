## The captain's state, as an autoload (Godot's global): coins, the fish in the hold, the upgrades bought, how many of
## each species have been sold at each port lately (a market tires of a fish), the port the boat is docked at, if any,
## and the clock (src/game/rules.ts): a day is DAYLEN seconds of sailing, and time stands still in port.
extends Node

signal changed

const DAYLEN := 480.0

## a new captain's purse (as the game starts one)
var coins := 50
## fish aboard: { sp, name, kg, stars, value }
var hold: Array[Dictionary] = []
## upgrade key -> the level bought (Upgrades)
var up: Dictionary[String, int] = {}
## port id -> species index -> fish sold there
var sold: Dictionary[String, Dictionary] = {}
## the port the boat lies at, or null while at sea
var docked: Ports.Port = null
## seconds of game time since the first day began (a new game starts early on the first morning)
var clock := DAYLEN * 0.08


func _process(delta: float) -> void:
	if docked == null:
		clock += delta


## How far through the day it is, 0..1 (0 is dawn).
func day_fraction() -> float:
	return fposmod(clock / DAYLEN, 1.0)


func day_number() -> int:
	return floori(clock / DAYLEN) + 1


## 0 by day, ramping to 1 through dusk and back down before dawn.
func darkness() -> float:
	var c := day_fraction()
	if c < 0.6: return 0.0
	if c < 0.68: return (c - 0.6) / 0.08
	if c < 0.9: return 1.0
	return 1.0 - (c - 0.9) / 0.1


func is_night() -> bool:
	return darkness() > 0.5


func is_twilight() -> bool:
	var c := day_fraction()
	return (c > 0.56 and c < 0.7) or c > 0.88 or c < 0.03


## Whether it's day by the inn's reckoning (resting skips to dusk then, to morning otherwise).
func is_daytime() -> bool:
	var c := day_fraction()
	return c > 0.04 and c < 0.58


## A night at the inn: by day, rest until dusk; by night, sleep until morning.
func rest() -> void:
	var base := floorf(clock / DAYLEN) * DAYLEN
	var c := day_fraction()
	clock = base + 0.6 * DAYLEN if is_daytime() else base + (DAYLEN if c >= 0.58 else 0.0) + 0.06 * DAYLEN
	changed.emit()


func add_fish(fish: Dictionary) -> void:
	hold.append(fish)
	changed.emit()


func add_coins(n: int) -> void:
	coins += n
	changed.emit()


## The level of upgrade `key` bought (0 for none).
func level(key: String) -> int:
	return up.get(key, 0)


## Buy the next level of upgrade `key`, if there is one and the purse holds its price. Whether it was bought.
func buy(key: String) -> bool:
	var price := Upgrades.cost(key, level(key))
	if price < 0 or price > coins:
		return false
	coins -= price
	up[key] = level(key) + 1
	changed.emit()
	return true

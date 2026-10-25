## The captain's state, as an autoload (Godot's global): coins, the fish in the hold, how many of each species have
## been sold at each port lately (a market tires of a fish), and the port the boat is docked at, if any.
extends Node

signal changed

## a new captain's purse (as the game starts one)
var coins := 50
## fish aboard: { sp, name, kg, stars, value }
var hold: Array[Dictionary] = []
## port id -> species index -> fish sold there
var sold: Dictionary[String, Dictionary] = {}
## the port the boat lies at, or null while at sea
var docked: Ports.Port = null


func add_fish(fish: Dictionary) -> void:
	hold.append(fish)
	changed.emit()


func add_coins(n: int) -> void:
	coins += n
	changed.emit()

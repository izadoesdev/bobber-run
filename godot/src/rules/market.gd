## Selling fish at a port (src/game/port/market.ts, ported): each port pays its own price for each species, and a
## market tires of a fish as it's sold there (7% less for each one lately, never below half price).
##
## Contracts, the harbour's asks, the cook, crew bonuses, the week's running fish and yachts' luxury come later.
class_name Market


## The price multiplier for species `sp` at port `p`, with `extra` more of it sold ahead in this sale.
static func price_at(p: Ports.Port, sp: int, extra := 0) -> float:
	var sold: int = State.sold.get(p.id, {}).get(sp, 0) + extra
	return p.mult[sp] * maxf(0.5, 1.0 - sold * 0.07)


## What selling the whole hold at port `p` pays.
static func sale_value(p: Ports.Port) -> int:
	var total := 0
	var ahead: Dictionary[int, int] = {}
	for f in State.hold:
		total += roundi(f.value * price_at(p, f.sp, ahead.get(f.sp, 0)))
		ahead[f.sp] = ahead.get(f.sp, 0) + 1
	return total


## Sell the whole hold at port `p`; the coins it paid.
static func sell_all(p: Ports.Port) -> int:
	var total := sale_value(p)
	if not State.sold.has(p.id):
		State.sold[p.id] = {}
	for f in State.hold:
		State.sold[p.id][f.sp] = State.sold[p.id].get(f.sp, 0) + 1
	State.hold.clear()
	State.add_coins(total)
	return total

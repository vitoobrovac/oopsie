"""Convert receipt amounts using the latest ECB reference rates."""

import asyncio
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, ROUND_HALF_UP
from typing import Literal
from xml.etree import ElementTree

import httpx

Currency = Literal["EUR", "USD", "GBP", "AUD", "CAD", "NZD", "CHF"]
ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ECB_NAMESPACE = "{http://www.ecb.int/vocabulary/2002-08-01/eurofxref}"
CACHE_SECONDS = 900


class RateUnavailable(Exception):
    pass


@dataclass(frozen=True)
class ExchangeRate:
    published_on: date
    units_per_eur: Decimal


_cache: tuple[float, dict[str, ExchangeRate]] | None = None
_lock = asyncio.Lock()


def parse_rates(document: bytes) -> dict[str, ExchangeRate]:
    published = next(cube for cube in ElementTree.fromstring(document).iter(ECB_NAMESPACE + "Cube")
                     if "time" in cube.attrib)
    published_on = date.fromisoformat(published.attrib["time"])
    rates = {}
    for cube in published:
        rate = Decimal(cube.attrib["rate"])
        if rate.is_finite() and rate > 0:
            rates[cube.attrib["currency"]] = ExchangeRate(published_on, rate)
    return rates


async def latest_rate(currency: Currency) -> ExchangeRate:
    global _cache
    async with _lock:
        if _cache is None or time.monotonic() - _cache[0] >= CACHE_SECONDS:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    response = await client.get(ECB_DAILY)
                    response.raise_for_status()
                rates = parse_rates(response.content)
            except (httpx.HTTPError, ElementTree.ParseError, StopIteration, KeyError, ValueError, InvalidOperation) as exc:
                raise RateUnavailable from exc
            _cache = (time.monotonic(), rates)
        try:
            return _cache[1][currency]
        except KeyError as exc:
            raise RateUnavailable from exc


def convert_receipt(amounts: list[int], rate: Decimal) -> tuple[int, list[int]]:
    exact = [Decimal(amount) / rate for amount in amounts]
    total = int((Decimal(sum(amounts)) / rate).to_integral_value(rounding=ROUND_HALF_UP))
    lines = [int(amount.to_integral_value(rounding=ROUND_FLOOR)) for amount in exact]
    # Assign remaining cents to the largest fractional remainders, keeping discounts negative.
    remainder = total - sum(lines)
    candidates = sorted(
        (index for index, amount in enumerate(amounts)
         if exact[index] > lines[index] and (amount > 0 or lines[index] < -1)),
        key=lambda index: exact[index] - lines[index], reverse=True,
    )
    if remainder < 0 or remainder > len(candidates):
        raise ValueError("These small line amounts cannot be represented as EUR cents. Check the discounts.")
    for index in candidates[:remainder]:
        lines[index] += 1
    return total, lines

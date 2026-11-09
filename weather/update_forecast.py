#!/usr/bin/env python3
"""Build SERENOVA Omiya weather JSON from Open-Meteo; never invent fallback values."""
import json, urllib.parse, urllib.request, datetime, os, sys
LAT, LON, TZ = 35.906, 139.624, "Asia/Tokyo"
def get_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":"SERENOVA-Weather/1.0"})
    with urllib.request.urlopen(req,timeout=40) as r:return json.loads(r.read().decode("utf-8"))
def main():
    p={"latitude":LAT,"longitude":LON,"timezone":TZ,"forecast_days":16,
       "current":"temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
       "hourly":"temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m",
       "daily":"weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,apparent_temperature_max,precipitation_sum,precipitation_probability_max,precipitation_hours,pressure_msl_mean,relative_humidity_2m_mean,cloud_cover_mean,wind_speed_10m_mean,wind_gusts_10m_max",
       "wind_speed_unit":"kmh"}
    fc=get_json("https://api.open-meteo.com/v1/forecast?"+urllib.parse.urlencode(p))
    upper={}
    try:
        q={"latitude":LAT,"longitude":LON,"timezone":TZ,"forecast_days":5,
           "hourly":"temperature_850hPa,temperature_700hPa,temperature_500hPa,wind_speed_300hPa,geopotential_height_500hPa"}
        ud=get_json("https://api.open-meteo.com/v1/forecast?"+urllib.parse.urlencode(q))
        uh=ud.get("hourly",{})
        for k in q["hourly"].split(","):
            vals=[v for v in uh.get(k,[]) if isinstance(v,(int,float))]
            upper[k]=vals[-1] if vals else None
        upper["summary"]=" / ".join(f"{k}: {v}" for k,v in upper.items() if v is not None) or "上空の気圧面データは未提供です。"
    except Exception as e: upper={"summary":"上空データ取得不可: "+str(e)[:120]}
    ensemble={"available":False,"note":"アンサンブルデータ未取得"}
    try:
        ep={"latitude":LAT,"longitude":LON,"timezone":TZ,"forecast_days":20,"models":"ncep_gefs025",
            "daily":"temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,pressure_msl_mean"}
        ed=get_json("https://ensemble-api.open-meteo.com/v1/ensemble?"+urllib.parse.urlencode(ep))
        ensemble={"available":bool(ed.get("daily")),"model":"ncep_gefs025","daily":ed.get("daily"),
                  "note":"GEFSアンサンブル。予報期間・メンバー数はAPIの提供範囲に依存します。"}
    except Exception as e: ensemble={"available":False,"note":"アンサンブル取得不可: "+str(e)[:160]}
    result={"location":"埼玉県さいたま市大宮","coordinates":{"latitude":LAT,"longitude":LON},
      "updated_at":datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec="minutes"),
      "source":"Open-Meteo","model":fc.get("models") or "Open-Meteo multi-model forecast",
      "timezone":fc.get("timezone",TZ),"current":fc.get("current",{}),"hourly":fc.get("hourly",{}),
      "daily":fc.get("daily",{}),"upper_air":upper,"ensemble":ensemble,
      "notes":["予報値であり実測値ではありません。","予報期間が長いほど不確実性が増します。","アンサンブル値が利用できない場合、確率は表示しません。"]}
    out=os.path.join(os.path.dirname(__file__),"forecast.json")
    with open(out,"w",encoding="utf-8") as f:json.dump(result,f,ensure_ascii=False,separators=(",",":"))
    print("Wrote",out,"daily days:",len(result["daily"].get("time",[])),"ensemble:",ensemble["available"])
if __name__=="__main__":
    try:main()
    except Exception as e:print("Weather update failed:",e,file=sys.stderr);sys.exit(1)

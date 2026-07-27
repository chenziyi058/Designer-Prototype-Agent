import argparse, json, time
from pathlib import Path
import serial

def main() -> None:
    parser=argparse.ArgumentParser(); parser.add_argument("--port", required=True); parser.add_argument("--output", default="data.jsonl"); args=parser.parse_args()
    with serial.Serial(args.port, 115200, timeout=1) as port, Path(args.output).open("a", encoding="utf-8") as output:
        while True:
            line=port.readline()
            if line:
                record={"host_time":time.time(),"device":json.loads(line)}; output.write(json.dumps(record,ensure_ascii=False)+"\n"); output.flush()
if __name__=="__main__": main()

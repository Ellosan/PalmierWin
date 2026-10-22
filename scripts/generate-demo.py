"""Create the original, procedural demo artwork and soundtrack. Requires Pillow + FFmpeg."""
from PIL import Image, ImageDraw, ImageFilter
import random, math, wave, struct, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'demo'
ROOT.mkdir(parents=True, exist_ok=True)
W, H = 1600, 900
random.seed(7)

def blend(a,b,t): return tuple(round(x+(y-x)*t) for x,y in zip(a,b))
def landscape(mode):
    im=Image.new('RGB',(W,H)); px=im.load()
    horizon=350 if mode!='water' else 130
    for y in range(H):
        color=blend((160,185,178),(231,221,188),min(1,y/horizon)) if y<horizon else blend((102,151,148),(22,79,83),(y-horizon)/(H-horizon))
        for x in range(W):
            noise=random.gauss(0,1.6); glow=max(0,1-math.hypot((x-1110)/850,(y-220)/480))*12
            px[x,y]=tuple(max(0,min(255,round(c+noise+glow))) for c in color)
    d=ImageDraw.Draw(im,'RGBA')
    d.ellipse((1085,193,1151,259),fill=(255,239,192,220))
    for i in range(500):
        y=random.randrange(horizon+8,H); x=random.randrange(W)
        length=int(5+(y/H)**3*90)
        d.line((x,y,x+length,y),fill=(225,234,211,random.randrange(4,24)),width=1)
    if mode!='water':
        # Distant mist, then layered headlands. These are illustrations, not stock photos.
        distant=[(0,410),(150,367),(240,374),(342,304),(460,338),(565,293),(710,345),(807,414)]
        d.polygon(distant,fill=(123,153,140,255))
        d.polygon([(0,420),(0,190),(90,209),(160,262),(233,286),(280,322),(349,338),(414,404),(595,440),(700,477),(635,493),(400,467),(231,448)],fill=(69,106,93,255))
        d.polygon([(0,900),(0,378),(143,412),(233,473),(340,470),(410,518),(492,522),(600,577),(743,615),(861,629),(993,714),(1190,760),(1390,900)],fill=(41,73,62,255))
        d.polygon([(0,900),(0,460),(145,490),(236,535),(379,540),(453,585),(583,607),(695,654),(854,697),(1004,770),(1135,900)],fill=(71,87,62,255))
        d.polygon([(0,900),(260,850),(355,740),(470,694),(548,681),(640,665),(723,670),(670,644),(540,659),(422,696),(319,749),(170,824)],fill=(168,150,110,255))
        for i in range(9000):
            x=random.randrange(1000); y=random.randrange(470,H)
            if x<max(0,(y-420)*1.6):
                d.ellipse((x,y,x+random.randrange(1,4),y+random.randrange(1,3)),fill=(124,128,79,random.randrange(10,50)))
        # Foam follows the base of the rocky coast.
        d.line([(220,449),(345,475),(450,490),(545,531),(650,560),(760,604),(860,613),(1000,683),(1190,737),(1400,835)],fill=(218,226,196,160),width=4)
    else:
        for i in range(42):
            y=190+i*20
            points=[(x,y+math.sin(x/130+i*.7)*(3+i*.2)) for x in range(0,W+1,5)]
            d.line(points,fill=(221,231,202,20+int(i*.4)),width=1+int(i/14))
    if mode=='headland':
        im=im.crop((0,190,1300,921)).resize((W,H),Image.Resampling.LANCZOS)
    return im

landscape('coast').save(ROOT/'coast.png')
landscape('headland').save(ROOT/'headland.png')
landscape('water').save(ROOT/'water.png')
rate=22050
with wave.open(str(ROOT/'tide.wav'),'wb') as out:
    out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
    audio=bytearray()
    for i in range(rate*20):
        t=i/rate; envelope=min(1,t/2,(20-t)/3)
        chord=sum(math.sin(2*math.pi*f*t+0.2*math.sin(t*.2))/(k+3) for k,f in enumerate([130.813,196,261.626,329.628]))
        tide=random.gauss(0,.12)*(.6+.4*math.sin(t*.7))
        audio+=struct.pack('<h',int((chord*.17+tide*.15)*envelope*32767))
    out.writeframes(audio)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(ROOT/'coast.png'),'-vf',"zoompan=z='1+on*0.00015':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=360:s=1600x900:fps=30",'-t','12','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(ROOT/'coast.mp4')],check=True)
print('Created original coastal demo assets in',ROOT)

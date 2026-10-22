"""Generate PalmierWin's original palm icon at Windows ICO sizes."""
from PIL import Image, ImageDraw
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'assets'
scale=16
image=Image.new('RGBA',(64*scale,64*scale))
d=ImageDraw.Draw(image)
d.rounded_rectangle((0,0,64*scale-1,64*scale-1),radius=16*scale,fill='#ded8c9')
def line(points):
 d.line([(round(x*scale),round(y*scale)) for x,y in points],fill='#292e26',width=round(3.5*scale),joint='curve')
def curve(a,b,c,e):
 return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*e[0],(1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*e[1]) for t in [i/100 for i in range(101)]]
line([(32,52),(32,26)])
for sign in [-1,1]:
 def point(x,y):return (32+sign*(x-32),y)
 line(curve(point(32,31),point(26,14),point(12,14),point(8,20))+curve(point(8,20),point(20,18),point(28,25),point(32,31)))
line(curve((32,25),(25,10),(29,5),(32,5))+curve((32,5),(35,5),(39,10),(32,25)))
image=image.resize((256,256),Image.Resampling.LANCZOS)
image.save(root/'icon.png')
image.save(root/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

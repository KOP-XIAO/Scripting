#!/usr/bin/env python3
"""Decorative widget artwork only. No screenshot or personal itinerary input."""
from pathlib import Path
import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, PngImagePlugin
ASSETS=Path(__file__).resolve().parents[1]/"assets"
SIZE=(1440,720)
def gradient(top,bottom):
 w,h=SIZE
 t=(np.linspace(0,1,h)[:,None]*.7+np.linspace(0,1,w)[None,:]*.3)[...,None]
 return Image.fromarray((np.array(top)*(1-t)+np.array(bottom)*t).astype("uint8")).convert("RGBA")
def layer(image,draw,blur=0):
 im=Image.new("RGBA",SIZE);draw(ImageDraw.Draw(im))
 return Image.alpha_composite(image,im.filter(ImageFilter.GaussianBlur(blur)) if blur else im)
def wash(im,color,alpha,min_strength=0):
 x=np.linspace(0,1,1440)[None,:];y=np.linspace(0,1,720)[:,None]
 strength=np.maximum(np.maximum((1-x)*.85,np.clip((y-.48)/.52,0,1)),min_strength)
 a=np.zeros((720,1440,4),dtype=np.uint8);a[...,:3]=color;a[...,3]=(strength*alpha).astype("uint8")
 return Image.alpha_composite(im,Image.fromarray(a))
def cyberpunk():
 im=gradient((5,14,29),(14,20,43))
 im=layer(im,lambda d:d.ellipse((900,-240,1780,560),fill=(9,157,188,100)),90)
 im=layer(im,lambda d:d.ellipse((1100,120,1630,720),fill=(178,18,127,65)),90)
 def city(d):
  rng=random.Random(37)
  for x in range(875,1440,44):
   top=rng.randint(150,370);d.rectangle((x,top,x+34,450),fill=(6,15,34,210))
   d.line((x,top,x+34,top),fill=(52,205,224,60),width=2)
   for y in range(top+16,430,20):
    for xx in range(x+5,x+31,12):
     if rng.random()>.45:d.rectangle((xx,y,xx+3,y+5),fill=(42,221,227,55))
  for i in range(5):
   y=100+i*70;d.line([(1440,y),(1260,y),(1210,y+38),(1130,y+38)],fill=(24,217,236,45),width=3)
   d.rectangle((1125,y+33,1135,y+43),outline=(49,233,242,55),width=2)
  for x in range(-500,2100,200):d.line((1020,430,x,720),fill=(31,172,205,28),width=2)
  for y in (460,510,580,680):d.line((0,y,1440,y),fill=(31,172,205,22),width=2)
  for y in range(0,720,6):d.line((0,y,1440,y),fill=(158,201,240,5),width=1)
 im=wash(layer(im,city),(6,14,28),140)
 def corners(d):
  for x,y,sx,sy in [(22,22,1,1),(1418,22,-1,1),(22,698,1,-1),(1418,698,-1,-1)]:
   d.line([(x+sx*36,y),(x,y),(x,y+sy*25)],fill=(252,235,62,165),width=3)
  for i in range(7):
   x=1300+i*18;d.polygon([(x,714),(x+8,714),(x-8,697),(x-16,697)],fill=(252,235,62,70))
 return layer(im,corners)
def anime():
 im=gradient((174,215,249),(246,244,221))
 def scene(d):
  for cx,cy,r in [(1010,145,65),(1100,115,80),(1190,155,62),(1305,100,78),(1400,140,73)]:
   d.ellipse((cx-r,cy-r*.65,cx+r,cy+r*.65+8),fill=(161,192,220,160))
   d.ellipse((cx-r,cy-r*.65-7,cx+r,cy+r*.65-7),fill=(255,255,249,240))
  d.ellipse((1230,30,1320,120),fill=(255,246,203,255))
  d.polygon([(760,390),(970,205),(1160,350),(1280,230),(1440,355),(1440,720),(760,720)],fill=(128,167,190,210))
  d.polygon([(970,205),(1035,268),(1000,253),(970,242),(940,260)],fill=(242,250,246,240))
  d.polygon([(760,470),(970,373),(1180,430),(1440,316),(1440,720),(760,720)],fill=(116,169,146,230))
  d.polygon([(730,550),(1020,455),(1440,480),(1440,720),(730,720)],fill=(92,145,105,200))
  d.line([(915,560),(1440,474)],fill=(80,94,95,140),width=5)
  d.line([(915,568),(1440,482)],fill=(80,94,95,100),width=3)
  d.rounded_rectangle((1200,471,1330,499),radius=9,fill=(245,249,242,245))
  d.rectangle((1208,481,1323,487),fill=(43,116,158,200))
  for x,y in [(1090,501),(1380,435)]:
   d.rectangle((x-3,y,x+3,y+52),fill=(96,109,84,190))
   d.polygon([(x,y-45),(x-25,y+12),(x+25,y+12)],fill=(70,121,92,200))
  for x,y in [(1130,45),(1160,58),(1190,41)]:d.line([(x-7,y+3),(x,y),(x+7,y+3)],fill=(54,94,128,180),width=2)
 return wash(layer(im,scene),(241,247,248),245,.65)
def travel():
 im=gradient((220,239,233),(191,220,210))
 a=np.asarray(im).copy();a[...,:3]=np.clip(a[...,:3].astype(float)+np.random.default_rng(12).normal(0,1.5,(720,1440,1)),0,255).astype("uint8");im=Image.fromarray(a)
 def map_art(d):
  for i in range(18):
   pts=[(x,105+i*27+math.sin(x/150+i*.3)*23+math.cos(x/270)*25) for x in range(-10,1460,12)]
   d.line(pts,fill=(94,136,121,28),width=2)
  d.polygon([(1030,0),(1080,170),(1020,260),(1110,450),(1200,720),(1440,720),(1440,0)],fill=(126,174,187,40))
  d.line([(1040,0),(1090,170),(1030,260),(1120,450),(1210,720)],fill=(83,133,159,48),width=3)
  pts=[(920+420*i/100,170+170*math.sin(i/100*math.pi)) for i in range(101)]
  for i in range(0,99,5):d.line(pts[i:i+3],fill=(151,85,56,155),width=3)
  for x,y in (pts[0],pts[-1]):d.ellipse((x-7,y-7,x+7,y+7),outline=(143,75,48,190),width=3)
  x,y=1310,120;d.ellipse((x-53,y-53,x+53,y+53),outline=(117,98,70,70),width=2)
  d.polygon([(x,y-45),(x-9,y),(x,y+45),(x+9,y)],fill=(117,98,70,90))
  d.line((x-40,y,x+40,y),fill=(117,98,70,70),width=2)
  d.rounded_rectangle((1230,520,1400,670),radius=6,outline=(163,99,70,75),width=3)
  d.ellipse((1255,540,1375,654),outline=(163,99,70,65),width=3)
 return wash(layer(im,map_art),(220,239,233),255,.93)
def midnight():
 im=gradient((18,26,40),(10,17,29))
 im=layer(im,lambda d:d.ellipse((840,-270,1610,500),fill=(41,75,119,90)),85)
 def night(d):
  # Keep moon and landscape dim enough for text, including custom accents.
  d.ellipse((1180,65,1315,200),fill=(46,64,86,255))
  d.ellipse((1208,49,1327,177),fill=(22,34,53,255))
  for x,y in [(940,90),(1090,55),(1370,230),(1140,245),(1000,195),(1340,40)]:
   d.ellipse((x-2,y-2,x+2,y+2),fill=(48,65,86,255))
  d.polygon([(330,720),(900,285),(1070,395),(1250,260),(1440,380),(1440,720),(330,720)],fill=(24,39,60,255))
  d.polygon([(350,720),(1050,420),(1220,475),(1440,350),(1440,720),(350,720)],fill=(16,29,47,255))
  d.line([(870,650),(1130,560),(1440,538)],fill=(44,64,87,255),width=4)
  d.line([(875,670),(1135,578),(1440,556)],fill=(35,53,75,255),width=3)
  for i in range(12):
   x=1160+i*25;y=558-(x-1160)*.07
   d.line((x,y,x+4,y+21),fill=(32,49,69,255),width=3)
 return wash(layer(im,night),(10,17,29),150,.65)
def mocha():
 im=gradient((250,246,239),(246,240,230))
 a=np.asarray(im).copy()
 a[...,:3]=np.clip(a[...,:3].astype(float)+np.random.default_rng(52).normal(0,.8,(720,1440,1)),0,255).astype('uint8')
 im=Image.fromarray(a)
 def paper(d):
  d.ellipse((870,-160,1630,600),fill=(235,222,205,255))
  d.ellipse((980,-110,1570,480),fill=(244,233,217,255))
  d.ellipse((1070,-65,1490,355),fill=(249,242,231,255))
  # A cropped coffee-ring motif, with soft contour lines instead of a busy photo.
  for inset in (0,13,28):
   d.ellipse((1150+inset,75+inset,1500-inset,425-inset),outline=(233+inset//4,220+inset//4,203+inset//4,255),width=3)
  for i in range(4):
   pts=[(830+x,520+i*22+math.sin(x/155+i*.15)*28) for x in range(0,620,6)]
   d.line(pts,fill=(229,217,199,255),width=2)
 return wash(layer(im,paper),(250,246,239),70,.65)
def film():
 im=gradient((33,28,23),(20,18,15))
 # Confine the exposure wash to the film frames, away from the primary text zones.
 y,x=np.mgrid[:720,:1440]
 frames=(((x>=940)&(x<=1250)&(y>=110)&(y<=330))|((x>=1292)&(y>=90)&(y<=308)))
 exposure=np.exp(-((x-1190)/230)**2-((y-190)/150)**2)*frames
 veil=np.zeros((720,1440,4),dtype=np.uint8);veil[...,:3]=(78,45,24);veil[...,3]=(exposure*170).astype('uint8')
 im=Image.alpha_composite(im,Image.fromarray(veil))
 def stock(d):
  # Sprockets stay inside the outer 5pt; the text begins at 14pt.
  for y,hole_y in ((0,8),(684,694)):
   d.rectangle((0,y,1440,y+35),fill=(76,50,29,255))
   for x in range(10,1440,52):
    d.rounded_rectangle((x,hole_y,x+25,hole_y+17),radius=3,fill=(14,12,9,255))
  d.line((0,36,1440,36),fill=(57,40,25,255),width=2)
  d.line((0,683,1440,683),fill=(57,40,25,255),width=2)
  for x,y in ((932,100),(1284,80)):
   d.rounded_rectangle((x,y,x+328,y+240),radius=7,outline=(68,47,29,255),width=3)
   for xx,yy,sx,sy in ((x+13,y+13,1,1),(x+315,y+13,-1,1),(x+13,y+227,1,-1),(x+315,y+227,-1,-1)):
    d.line([(xx+sx*28,yy),(xx,yy),(xx,yy+sy*22)],fill=(70,50,32,255),width=3)
   for tick in range(6):
    xx=x+18+tick*9;d.line((xx,y-14,xx,y-6),fill=(65,46,28,255),width=2)
  # A faint six-blade aperture etching stays decorative, with no extra labels.
  cx,cy=1052,224
  opening=[(cx+32*math.cos(i*math.pi/3+.3),cy+32*math.sin(i*math.pi/3+.3)) for i in range(7)]
  d.line(opening,fill=(64,47,30,255),width=3)
  for i in range(6):
   angle=i*math.pi/3+.3
   d.line([opening[i],(cx+76*math.cos(angle+.45),cy+76*math.sin(angle+.45))],fill=(56,42,28,255),width=3)
  d.arc((cx-82,cy-82,cx+82,cy+82),110,300,fill=(47,36,25,255),width=2)
  for offset in (0,15,30):
   d.line([(1304+offset,292),(1330+offset,266)],fill=(65,45,28,255),width=3)
  d.line((914,70,1440,70),fill=(51,37,25,255),width=2)
  d.line((914,370,1245,370),fill=(60,42,26,255),width=3)
  d.line((1270,350,1440,350),fill=(53,39,26,255),width=2)
 im=layer(im,stock)
 im.info["pnginfo"]=PngImagePlugin.PngInfo()
 im.info["pnginfo"].add_text("Source","Original procedural artwork: trip-reminder/tools/build-theme-assets.py:film")
 im.info["pnginfo"].add_text("Description","Movie-film travel: warm charcoal and sprocket rails, staggered exposure frames with a soft amber wash, six-blade aperture etching, viewfinder crop corners and splice marks. No text or personal imagery; dark decoration preserves itinerary readability.")
 return im
def space():
 im=gradient((12,16,34),(21,19,41))
 orbit=[(1276+438*math.cos(t)*math.cos(-.26)-92*math.sin(t)*math.sin(-.26),132+438*math.cos(t)*math.sin(-.26)+92*math.sin(t)*math.cos(-.26)) for t in np.linspace(0,2*math.pi,241)]
 def odyssey(d):
  for x,y,r in [(704,76,1),(782,266,1),(858,132,2),(932,43,1),(990,314,1),(1087,59,1),(1157,274,1),(1372,330,2),(1410,108,1),(825,344,1),(1050,174,1),(1322,39,1)]:
   d.ellipse((x-r,y-r,x+r,y+r),fill=(49,45,71,255))
  d.line(orbit,fill=(45,39,65,255),width=3)
  # A large cropped planetary limb, with no moon or ground silhouette.
  d.ellipse((1032,-322,1736,382),fill=(29,27,53,255),outline=(62,47,78,255),width=6)
  d.arc((1042,-312,1726,372),80,244,fill=(44,38,67,255),width=6)
  d.line(orbit[:121],fill=(57,45,74,255),width=4)
 im=layer(im,odyssey)
 im.info["pnginfo"]=PngImagePlugin.PngInfo()
 im.info["pnginfo"].add_text("Source","Original procedural artwork: trip-reminder/tools/build-theme-assets.py:space")
 im.info["pnginfo"].add_text("Description","Space odyssey: deep ink and indigo, a large cropped planetary limb and tilted elliptic orbit in the upper right, sparse dim stars, and a quiet lower text band. Motif colors remain below 0.045 sRGB relative luminance.")
 return im
if __name__=="__main__":
 ASSETS.mkdir(exist_ok=True)
 for name,build in [("cyberpunk",cyberpunk),("anime",anime),("travel",travel),("midnight",midnight),("mocha",mocha),("film",film),("space",space)]:
  im=build();assert im.size==SIZE and im.getextrema()[3]==(255,255)
  im.save(ASSETS/f"theme-{name}.png",optimize=True,pnginfo=im.info.get("pnginfo"));print(f"Built {name}: {im.size}")

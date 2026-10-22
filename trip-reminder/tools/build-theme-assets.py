#!/usr/bin/env python3
"""Decorative widget artwork only. No screenshot or personal itinerary input."""
from pathlib import Path
import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
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
if __name__=="__main__":
 ASSETS.mkdir(exist_ok=True)
 for name,build in [("cyberpunk",cyberpunk),("anime",anime),("travel",travel),("midnight",midnight),("mocha",mocha)]:
  im=build();assert im.size==SIZE and im.getextrema()[3]==(255,255)
  im.save(ASSETS/f"theme-{name}.png",optimize=True);print(f"Built {name}: {im.size}")

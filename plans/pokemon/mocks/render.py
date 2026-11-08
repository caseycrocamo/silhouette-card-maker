from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
OUT=Path(__file__).parent
BG='#1E232F'; PANEL='#2A303C'; DARK='#16181D'; TEXT='#F1F5F9'; MUTED='#CBD5E1'; LINE='#788495'
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'; BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(n=18,b=False): return ImageFont.truetype(BOLD if b else FONT,n)
def text(x,y,s,n=18,c=TEXT,b=False): d.text((x,y),s,font=font(n,b),fill=c)
def box(x,y,w,h,fill=PANEL,outline=LINE): d.rounded_rectangle((x,y,x+w,y+h),radius=12,fill=fill,outline=outline,width=1)
def dash(x,y,w,h):
 box(x,y,w,h)
 # Shared paper surface uses a dashed outline.
 for xx in range(x+14,x+w-14,14):
  d.line((xx,y,xx+7,y),fill=MUTED,width=2);d.line((xx,y+h,xx+7,y+h),fill=MUTED,width=2)
def button(x,y,w,label,disabled=False):
 box(x,y,w,46,DARK,LINE if disabled else MUTED)
 tw=d.textbbox((0,0),label,font=font(16,b=True))[2];text(x+(w-tw)/2,y+13,label,16,LINE if disabled else TEXT,True)
def base(step,tag):
 global im,d
 im=Image.new('RGB',(1440,1100),BG);d=ImageDraw.Draw(im)
 d.rounded_rectangle((0,-8,1439,68),radius=8,fill=DARK)
 labels=['Choose Game','Card List','Create PDF']
 widths=[int(d.textlength(label,font=font(16)))+54 if i==step else 32 for i,label in enumerate(labels,1)]
 gap=(500-sum(widths))/2
 x=470
 for i,(label,w) in enumerate(zip(labels,widths),1):
  active=i==step
  fill=MUTED if active else PANEL
  d.rounded_rectangle((x,17,x+w,49),radius=16,fill=fill)
  # Dashed pill border used by the existing shared navbar.
  import math
  points=[]
  for cx,start in [(x+w-16,-90),(x+16,90)]:
   for angle in range(start,start+181,3):
    r=math.radians(angle);points.append((cx+16*math.cos(r),33+16*math.sin(r)))
  points.append(points[0])
  for j in range(0,len(points)-1,4): d.line(points[j:j+3],fill=MUTED,width=2)
  text(x+11,23,str(i),16,DARK if active else MUTED)
  if active: text(x+32,23,label,16,DARK)
  if i<3:
   middle=x+w+gap/2
   d.line((middle-32,33,middle+32,33),fill='#505660',width=2)
  x+=w+gap
 # Preserve the existing Settings icon at the right edge.
 gx,gy=1390,33
 for angle in range(0,360,45):
  r=math.radians(angle)
  d.line((gx+10*math.cos(r),gy+10*math.sin(r),gx+15*math.cos(r),gy+15*math.sin(r)),fill=MUTED,width=3)
 d.ellipse((gx-11,gy-11,gx+11,gy+11),outline=MUTED,width=2)
 d.ellipse((gx-4,gy-4,gx+4,gy+4),outline=MUTED,width=2)
 text(60,105,tag,14,MUTED)
 text(60,1060,'DESIGN MOCK  •  Proposed shared card-list UI  •  Card art shown as placeholders',14,MUTED)
def save(name): im.save(OUT/name)
def card(x,y,name,code,qty,mtg=False):
 box(x,y,222,326,DARK)
 box(x+12,y+12,198,220,'#343E4E','#586779')
 d.ellipse((x+75,y+77,x+146,y+148),outline='#8290A4',width=2)
 d.line((x+75,y+113,x+146,y+113),fill='#8290A4',width=2)
 text(x+42,y+182,'CARD PREVIEW',14,MUTED)
 box(x+156,y+23,42,28,DARK);text(x+165,y+29,f'×{qty}',14,b=True)
 text(x+13,y+247,name,17,b=True);text(x+13,y+274,code,15,MUTED)
 if mtg: text(x+13,y+300,'Change printing v',14,MUTED)
base(1,'01 / CHOOSE GAME')
dash(200,202,1040,610)
text(424,247,'Choose your game',40,b=True);text(431,303,'Build a card list, then create a print PDF.',21,MUTED)
for x,title,desc in [(260,'Magic: The Gathering','Search cards and select printings.'),(740,'Pokémon','Use a Limitless deck list.')]:
 box(x,389,440,300,DARK);text(x+28,425,title,29,b=True)
 button(x+28,510,384,'Search cards and select printings' if x==260 else 'Use a Limitless deck list')
 if x==260: button(x+28,574,384,'Text Translation')
text(509,756,'Printer calibration is available in Settings.',16,MUTED)
save('01-choose-game.png')
def editor(mtg=False,errors=False):
 base(2,'02 / CARD LIST  /  '+('MAGIC: THE GATHERING' if mtg else 'POKÉMON'))
 text(60,146,('Magic: The Gathering' if mtg else 'Pokémon')+' card list',36,b=True)
 text(60,197,'Paste a deck list. Review each card before you create the PDF.',19,MUTED)
 button(1184,143,196,'Change game')
 dash(60,249,440,590);text(84,273,'Deck list',25,b=True)
 text(84,316,'MTG text format' if mtg else 'Format: Limitless',17,MUTED)
 box(84,354,392,282,DARK)
 lines=['1x Sol Ring (eoc) 57','1x Black Lotus (lea) 232','1x Mox Pearl (leb) 262'] if mtg else ['Pokémon: 4','1 Pikachu ex SVI 047','3 Charcadet SSP 32','','Trainer: 3','3 Nest Ball SVI 181','','Energy: 2','2 Fire Energy SVE 18']
 if errors: lines[2]='3 Charcadet SSP'
 for i,s in enumerate(lines): text(100,372+i*26,s,17,'#F6B7B7' if errors and i==2 else MUTED)
 text(84,654,'Set and number are optional.' if mtg else 'Include the quantity, name, set, and number.',15,MUTED)
 button(84,694,392,'Search Cards');button(84,752,392,'Export Decklist')
 dash(532,249,848,590);text(556,273,'Search results',25,b=True)
 text(556,314,'2 cards ready • 1 line needs a fix • 1 download failed' if errors else ('3 entries • 3 cards ready' if mtg else '4 entries • 9 cards ready'),17,MUTED)
 if errors:
  box(556,357,800,99,'#412E36','#AD7886');text(576,376,'Line 3: Add the card number after SSP.',18,b=True);text(576,411,'Edit the deck list, then select Search Cards.',16,MUTED)
  card(556,480,'Pikachu ex','SVI 047',1)
  box(802,480,308,218,DARK,'#AD7886');text(823,503,'Nest Ball',21,b=True);text(823,544,'SVI 181  •  ×3',17,MUTED);text(823,584,'The image did not load.',17);button(823,628,264,'Retry failed cards')
  text(556,812,'Fix all errors before you continue.',17,'#F6B7B7')
 else:
  vals=[('Sol Ring','EOC 57',1),('Black Lotus','LEA 232',1),('Mox Pearl','LEB 262',1)] if mtg else [('Pikachu ex','SVI 047',1),('Charcadet','SSP 32',3),('Nest Ball','SVI 181',3)]
  for i,v in enumerate(vals): card(556+i*264,357,*v,mtg)
  if not mtg: text(556,726,'Also ready: Fire Energy  ·  SVE 18  ·  ×2',18,MUTED)
  text(556,785,'Select a set to change a printing.' if mtg else 'Printing comes from the set and number in your list.',16,MUTED)
 dash(60,871,1320,148);text(84,895,'Printing workflow',21,b=True)
 text(84,937,'○ Front Only     ● Double Sided' if mtg else 'Fronts only',19)
 text(84,974,'Keep the current MTG face and back behavior.' if mtg else 'Use the PDF page to change page size, cut guides, and other print settings.',16,MUTED)
 button(1086,919,270,'Next: Create PDF',errors)
 save('04-mtg-shared.png' if mtg else ('03-pokemon-errors.png' if errors else '02-pokemon-ready.png'))
editor();editor(errors=True);editor(mtg=True)

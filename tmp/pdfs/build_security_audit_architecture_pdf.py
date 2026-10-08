from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    LongTable, TableStyle, KeepTogether, Flowable, Preformatted
)

ROOT = Path('/Users/daitongmin/security')
SOURCE = ROOT / 'security-audit-skill-architecture.md'
OUTPUT = ROOT / 'output/pdf/security-audit-skill-architecture.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

FONT = '/System/Library/Fonts/STHeiti Light.ttc'
FONT_BOLD = '/System/Library/Fonts/STHeiti Medium.ttc'
pdfmetrics.registerFont(TTFont('CN', FONT, subfontIndex=0))
pdfmetrics.registerFont(TTFont('CN-Bold', FONT_BOLD, subfontIndex=0))

PAGE = landscape(A4)
W, H = PAGE
NAVY = colors.HexColor('#17324D')
BLUE = colors.HexColor('#2E6F9E')
PALE_BLUE = colors.HexColor('#EAF3F8')
PALE_GREEN = colors.HexColor('#EAF5EF')
PALE_AMBER = colors.HexColor('#FFF4DC')
PALE_GRAY = colors.HexColor('#F4F6F8')
MID_GRAY = colors.HexColor('#647482')
LINE = colors.HexColor('#B9C6D0')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='CNTitle', fontName='CN-Bold', fontSize=24, leading=31,
                          textColor=NAVY, alignment=TA_CENTER, spaceAfter=12))
styles.add(ParagraphStyle(name='CNH1', fontName='CN-Bold', fontSize=17, leading=22,
                          textColor=NAVY, spaceBefore=9, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name='CNH2', fontName='CN-Bold', fontSize=13, leading=18,
                          textColor=BLUE, spaceBefore=8, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle(name='CNBody', fontName='CN', fontSize=9.4, leading=14,
                          textColor=colors.HexColor('#263846'), spaceAfter=5))
styles.add(ParagraphStyle(name='CNQuote', fontName='CN', fontSize=9, leading=13,
                          leftIndent=10, rightIndent=10, borderColor=BLUE, borderWidth=1,
                          borderPadding=7, backColor=PALE_BLUE, spaceBefore=4, spaceAfter=7))
styles.add(ParagraphStyle(name='CNCode', fontName='CN', fontSize=8.3, leading=12,
                          leftIndent=8, rightIndent=8, borderColor=LINE, borderWidth=.5,
                          borderPadding=7, backColor=PALE_GRAY, spaceAfter=7))
styles.add(ParagraphStyle(name='Cell', fontName='CN', fontSize=7.4, leading=10,
                          textColor=colors.HexColor('#263846')))
styles.add(ParagraphStyle(name='CellHead', fontName='CN-Bold', fontSize=7.6, leading=10,
                          textColor=colors.white, alignment=TA_CENTER))
styles.add(ParagraphStyle(name='Box', fontName='CN', fontSize=7.6, leading=10,
                          alignment=TA_CENTER, textColor=colors.HexColor('#203442')))


def clean_inline(text):
    text = re.sub(r'`([^`]+)`', r'<font name="CN-Bold">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return text


class ArchitectureDiagram(Flowable):
    def __init__(self, index, width=245*mm, height=118*mm):
        super().__init__()
        self.index = index
        self.width = width
        self.height = height

    def _box(self, c, x, y, w, h, text, fill=PALE_BLUE, stroke=LINE, size=7.4):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
        p = Paragraph(text, ParagraphStyle('db', parent=styles['Box'], fontSize=size, leading=size+2))
        pw, ph = p.wrap(w-8, h-5)
        p.drawOn(c, x+4, y+(h-ph)/2)

    def _arrow(self, c, x1, y1, x2, y2, label=None):
        c.setStrokeColor(MID_GRAY)
        c.setFillColor(MID_GRAY)
        c.setLineWidth(1)
        c.line(x1, y1, x2, y2)
        import math
        a = math.atan2(y2-y1, x2-x1)
        al = 5
        for d in (2.6, -2.6):
            c.line(x2, y2, x2-al*math.cos(a+d), y2-al*math.sin(a+d))
        if label:
            c.setFont('CN', 6.5)
            c.drawCentredString((x1+x2)/2, (y1+y2)/2+3, label)

    def draw(self):
        c = self.canv
        if self.index == 0:
            self._draw_overall(c)
        elif self.index == 1:
            self._draw_sequence(c)
        elif self.index == 2:
            self._draw_finding(c)
        elif self.index == 3:
            self._draw_boundaries(c)
        else:
            self._draw_extension(c)

    def _draw_overall(self, c):
        w, h = self.width, self.height
        xs = [5, 54, 103, 152, 201]
        bw, bh = 41*mm, 13*mm
        titles = ['用户请求', '侦察层', '漏洞发现层', '独立验证层', '报告层']
        fills = [PALE_GRAY, PALE_BLUE, PALE_AMBER, PALE_GREEN, PALE_BLUE]
        y = h-22*mm
        for i, (xmm, t) in enumerate(zip(xs, titles)):
            x = xmm*mm
            self._box(c, x, y, bw, bh, f'<b>{t}</b>', fills[i])
            if i < 4:
                self._arrow(c, x+bw, y+bh/2, xs[i+1]*mm, y+bh/2)
        rows = [
            ('父 Agent / Parent', '四类 Recon Agent', 'Hunter A…N', 'Candidate Verifier', 'REPORT.md'),
            ('调度、预算、共享状态', '架构、边界、入口、执行条件', '按 coverage unit 检查', '尝试反驳候选', 'FINDINGS-DETAIL.md'),
            ('宿主平台工具', 'architecture.md', 'Coverage Critic', 'Final Record Verifier', 'NEEDS-VALIDATION.md'),
        ]
        ry = y-24*mm
        for r, row in enumerate(rows):
            for i, text in enumerate(row):
                fill = colors.white if r != 1 else PALE_GRAY
                self._box(c, xs[i]*mm, ry-r*20*mm, bw, 14*mm, text, fill, LINE, 7)
        ly = 7*mm
        self._box(c, 54*mm, ly, 90*mm, 14*mm, '<b>coverage-ledger.json</b><br/>确定性覆盖状态机', PALE_BLUE)
        self._box(c, 154*mm, ly, 90*mm, 14*mm, '<b>findings.json + JavaScript Validators</b><br/>结构化结论与一致性校验', PALE_GREEN)
        self._arrow(c, 144*mm, ly+7*mm, 154*mm, ly+7*mm)

    def _draw_sequence(self, c):
        actors = ['父 Agent', '子 Agent 调度', '侦察 Agent', '文件/搜索工具', '共享状态']
        xs = [10, 58, 106, 154, 202]
        top = self.height-18*mm
        for x, a in zip(xs, actors):
            self._box(c, x*mm, top, 36*mm, 12*mm, f'<b>{a}</b>', PALE_BLUE)
            c.setStrokeColor(LINE); c.setDash(2,2); c.line((x+18)*mm, top, (x+18)*mm, 12*mm); c.setDash()
        events = [
            (0,1,'创建 research Agent'), (1,2,'初始化独立上下文'),
            (2,3,'读取源码、配置、测试'), (3,2,'返回文件与搜索结果'),
            (2,0,'结构化源码事实'), (0,4,'写 architecture.md'),
            (0,4,'写 coverage-ledger.json')]
        y = top-14*mm
        for a,b,label in events:
            x1=(xs[a]+18)*mm; x2=(xs[b]+18)*mm
            self._arrow(c,x1,y,x2,y,label)
            y-=12*mm

    def _draw_finding(self, c):
        nodes = [
            ('Coverage Unit', PALE_BLUE), ('Hunter Prompt', PALE_BLUE), ('源码路径追踪', PALE_AMBER),
            ('Candidate Gate', PALE_AMBER), ('独立 Verifier', PALE_GREEN), ('最终 Verdict', PALE_GREEN)]
        x=4*mm; y=self.height-30*mm; bw=36*mm; bh=15*mm
        for i,(t,fill) in enumerate(nodes):
            self._box(c,x+i*40*mm,y,bw,bh,f'<b>{t}</b>',fill)
            if i<len(nodes)-1: self._arrow(c,x+i*40*mm+bw,y+bh/2,x+(i+1)*40*mm,y+bh/2)
        outputs=[('无真实边界影响','拒绝 / Hardening'),('关键事实缺失','needs_validation'),('完整路径和观察结果','confirmed')]
        for i,(cond,res) in enumerate(outputs):
            bx=(45+i*67)*mm
            self._box(c,bx,35*mm,58*mm,18*mm,f'<b>{cond}</b><br/>{res}',[PALE_GRAY,PALE_AMBER,PALE_GREEN][i])
            self._arrow(c,142*mm,y,bx+29*mm,53*mm)
        self._box(c,55*mm,7*mm,145*mm,15*mm,'正式确认要求：低信任主体 + 可控输入 + 应有控制 + 完整源码路径 + 跨边界结果 + 独立复核',PALE_BLUE)

    def _draw_boundaries(self, c):
        self._box(c,8*mm,self.height-28*mm,56*mm,18*mm,'<b>Markdown 工作流</b><br/>角色、范围、证据规则',PALE_BLUE)
        self._box(c,92*mm,self.height-28*mm,56*mm,18*mm,'<b>大模型 Agent</b><br/>语义分析与任务分工',PALE_AMBER)
        self._box(c,176*mm,self.height-28*mm,56*mm,18*mm,'<b>宿主平台工具</b><br/>文件、命令、子 Agent',PALE_GREEN)
        self._arrow(c,64*mm,self.height-19*mm,92*mm,self.height-19*mm)
        self._arrow(c,148*mm,self.height-19*mm,176*mm,self.height-19*mm)
        tools=['CodeQL','Semgrep','Burp / ZAP','Trivy / Snyk']
        for i,t in enumerate(tools):
            self._box(c,(12+i*60)*mm,45*mm,48*mm,15*mm,t,colors.white,MID_GRAY)
        self._box(c,52*mm,10*mm,145*mm,20*mm,'<b>当前真实边界</b><br/>未内置第三方安全工具适配器；本地 JavaScript 仅校验审计产物，不检测漏洞。',PALE_AMBER)

    def _draw_extension(self, c):
        labels=['侦察与工具选择','安全工具适配层','隔离沙箱执行','结果标准化与映射','Hunter 源码验证','独立验证与报告']
        x=4*mm; y=self.height-28*mm; bw=36*mm; bh=17*mm
        for i,t in enumerate(labels):
            fill=[PALE_BLUE,PALE_AMBER,PALE_AMBER,PALE_BLUE,PALE_GREEN,PALE_GREEN][i]
            self._box(c,x+i*40*mm,y,bw,bh,f'<b>{t}</b>',fill)
            if i<len(labels)-1:self._arrow(c,x+i*40*mm+bw,y+bh/2,x+(i+1)*40*mm,y+bh/2)
        tools='Semgrep / CodeQL　　Trivy / Grype / OSV　　Secret Scanner　　Sanitizer / Fuzzer　　IaC / Policy'
        self._box(c,24*mm,52*mm,205*mm,18*mm,f'<b>可选第三方工具</b><br/>{tools}',PALE_GRAY)
        self._box(c,24*mm,15*mm,205*mm,22*mm,'<b>扩展约束</b><br/>工具告警只能成为候选线索；仍须经过边界分析、源码验证、最小观察结果、独立复核和现有 Validator。',PALE_BLUE)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(18*mm, 12*mm, W-18*mm, 12*mm)
    canvas.setFont('CN', 7.5)
    canvas.setFillColor(MID_GRAY)
    canvas.drawString(18*mm, 7*mm, 'Security Audit Skill 专业架构说明')
    canvas.drawRightString(W-18*mm, 7*mm, f'第 {doc.page} 页')
    canvas.restoreState()


doc = BaseDocTemplate(str(OUTPUT), pagesize=PAGE,
                      leftMargin=18*mm, rightMargin=18*mm,
                      topMargin=16*mm, bottomMargin=17*mm,
                      title='Security Audit Skill 专业架构说明', author='Codex')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='main')
doc.addPageTemplates(PageTemplate(id='standard', frames=[frame], onPage=footer))

lines = SOURCE.read_text(encoding='utf-8').splitlines()
story = []
diagram_index = 0
i = 0
first_title = True
while i < len(lines):
    line = lines[i].rstrip()
    if line.startswith('```mermaid'):
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            i += 1
        story.append(Spacer(1, 2*mm))
        story.append(ArchitectureDiagram(diagram_index))
        story.append(Spacer(1, 4*mm))
        diagram_index += 1
    elif line.startswith('```'):
        block=[]; i+=1
        while i < len(lines) and not lines[i].startswith('```'):
            block.append(lines[i]); i+=1
        story.append(Preformatted('\n'.join(block), styles['CNCode']))
    elif line.startswith('# '):
        if not first_title: story.append(PageBreak())
        story.append(Spacer(1, 15*mm))
        story.append(Paragraph(clean_inline(line[2:]), styles['CNTitle']))
        story.append(Paragraph('多智能体审计编排、证据验证与工具边界',
                               ParagraphStyle('subtitle', parent=styles['CNBody'], fontSize=12,
                                              leading=17, alignment=TA_CENTER, textColor=MID_GRAY)))
        story.append(Spacer(1, 8*mm))
        story.append(PageBreak())
        first_title=False
    elif line.startswith('## '):
        story.append(Paragraph(clean_inline(line[3:]), styles['CNH1']))
    elif line.startswith('### '):
        story.append(Paragraph(clean_inline(line[4:]), styles['CNH2']))
    elif line.startswith('> '):
        story.append(Paragraph(clean_inline(line[2:]), styles['CNQuote']))
    elif line.startswith('|'):
        rows=[]
        while i < len(lines) and lines[i].startswith('|'):
            cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-{3,}:?', c or '') for c in cells): rows.append(cells)
            i+=1
        i-=1
        n=max(len(r) for r in rows)
        data=[]
        for ridx,row in enumerate(rows):
            row += ['']*(n-len(row))
            style=styles['CellHead'] if ridx==0 else styles['Cell']
            data.append([Paragraph(clean_inline(c),style) for c in row])
        if n==5: widths=[34*mm,24*mm,43*mm,80*mm,64*mm]
        elif n==4: widths=[43*mm,61*mm,92*mm,49*mm]
        elif n==2: widths=[52*mm,193*mm]
        else: widths=[245*mm/n]*n
        tab=LongTable(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
        tab.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),NAVY),('TEXTCOLOR',(0,0),(-1,0),colors.white),
            ('FONTNAME',(0,0),(-1,0),'CN-Bold'),('VALIGN',(0,0),(-1,-1),'TOP'),
            ('GRID',(0,0),(-1,-1),.35,LINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE_GRAY]),
            ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
            ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
        ]))
        story.extend([tab,Spacer(1,5*mm)])
    elif re.match(r'^\d+\. ', line):
        story.append(Paragraph(clean_inline(line), styles['CNBody']))
    elif line.startswith('- '):
        story.append(Paragraph('• '+clean_inline(line[2:]), ParagraphStyle('bulletx', parent=styles['CNBody'], leftIndent=10, firstLineIndent=-7)))
    elif line.strip():
        story.append(Paragraph(clean_inline(line), styles['CNBody']))
    i += 1

doc.build(story)
print(OUTPUT)

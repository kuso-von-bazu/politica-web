/* POLITICA -ポリティカ- データ定義
   原作: Foundation games / POLITICA (プロトタイプ) を参照したデジタル版。
   カードデータは同梱の「カード一覧.xlsx」から機械抽出。
   Node/ブラウザ両対応 (root.PL_DATA)。 */
(function (root) {
  'use strict';

  // 5大イデオロギー
  var IDEOLOGIES = [
    { key: 'cap', jp: '資本主義', short: '資本', color: '#e0a82e', icon: '¥' },
    { key: 'mil', jp: '軍国主義', short: '軍国', color: '#6b3f3f', icon: '⚔' },
    { key: 'com', jp: '共産主義', short: '共産', color: '#c0392b', icon: '☭' },
    { key: 'sci', jp: '科学主義', short: '科学', color: '#2e7dd1', icon: '⚗' },
    { key: 'env', jp: '環境主義', short: '環境', color: '#3a9d4a', icon: '🌿' }
  ];

  // 勝利: いずれかのイデオロギーIPがこの値で勝利
  var WIN_IP = 20;

  // イデオロギー補正: 法案/IPで得るIPに掛ける重み。各思想の勝率を均すためのバランス調整値。
  var IDEO_WEIGHT = { cap: 1.0, mil: 1.04, com: 1.43, sci: 1.0, env: 0.86 };

  // 盤面トラック (外周ループ)。kind と説明。
  var BOARD = [
    { kind: 'election',   label: '総選挙' },
    { kind: 'politician', label: '政治家獲得' },
    { kind: 'ip',         label: 'IP' },
    { kind: 'chance',     label: 'チャンス' },
    { kind: 'incident',   label: 'インシデント' },
    { kind: 'law',        label: '法案提出' },
    { kind: 'money',      label: '献金' },
    { kind: 'rest',       label: '一回休み' },
    { kind: 'politician', label: '政治家獲得' },
    { kind: 'ip',         label: 'IP' },
    { kind: 'incident',   label: 'インシデント' },
    { kind: 'chance',     label: 'チャンス' },
    { kind: 'law',        label: '法案提出' },
    { kind: 'ip',         label: 'IP' },
    { kind: 'politician', label: '政治家獲得' },
    { kind: 'incident',   label: 'インシデント' },
    { kind: 'money',      label: '献金' },
    { kind: 'chance',     label: 'チャンス' },
    { kind: 'law',        label: '法案提出' },
    { kind: 'rest',       label: '一回休み' },
    { kind: 'ip',         label: 'IP' },
    { kind: 'politician', label: '政治家獲得' },
    { kind: 'incident',   label: 'インシデント' },
    { kind: 'chance',     label: 'チャンス' }
  ];

  // 基幹政策カード (各イデオロギー1枚)。成立で第2の勝利条件を達成。
  var BASIC_POLICIES = [
    { id: 'b_cap', name: '自由市場憲章',     ideo: 'cap', need: 12, d: { cap: 3, mil: 0, com: -2, sci: 1, env: -1 } },
    { id: 'b_mil', name: '国家総動員法',     ideo: 'mil', need: 12, d: { cap: 0, mil: 3, com: -1, sci: 1, env: -2 } },
    { id: 'b_com', name: '一党独裁体制',     ideo: 'com', need: 12, d: { cap: -2, mil: 0, com: 3, sci: 0, env: 0 } },
    { id: 'b_sci', name: '技術立国計画',     ideo: 'sci', need: 12, d: { cap: 1, mil: 0, com: 0, sci: 3, env: 1 } },
    { id: 'b_env', name: '持続可能社会基本法', ideo: 'env', need: 12, d: { cap: -1, mil: -2, com: 1, sci: 1, env: 3 } }
  ];

  var PLAYER_COLORS = ['#d24b4b', '#3f76d2', '#2f9e54', '#c79a2e'];
  var PLAYER_COLOR_NAMES = ['レッド', 'ブルー', 'グリーン', 'イエロー'];

  var POLITICIANS = [
    {"name": "仲田角兵衛", "ideo": "cap", "infl": {"cap": 8, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "（１）このカードが党首の時には、チャンスカードマスを通過した時にチャンスカードを引くことができる。 （２）信用度を−１する度（信用度が０の際は使用できない）、チャンスカードを引ける （３）このカードが内閣から落ちた場合、信用度が−３される", "id": "p0"},
    {"name": "岸　紳助", "ideo": "cap", "infl": {"cap": 6, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p1"},
    {"name": "佐藤丁作", "ideo": "cap", "infl": {"cap": 6, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "このカードが党首の時にはチャンスカードを一枚追加で引ける。", "id": "p2"},
    {"name": "渋沢　英治", "ideo": "cap", "infl": {"cap": 3, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p3"},
    {"name": "村田　茂", "ideo": "cap", "infl": {"cap": 6, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p4"},
    {"name": "今泉　純一郎", "ideo": "cap", "infl": {"cap": 5, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p5"},
    {"name": "永津根　康弘", "ideo": "cap", "infl": {"cap": 5, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p6"},
    {"name": "石渡　湛山", "ideo": "cap", "infl": {"cap": 3, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p7"},
    {"name": "生原　喜重郎", "ideo": "cap", "infl": {"cap": 3, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p8"},
    {"name": "棚橋　是清", "ideo": "cap", "infl": {"cap": 3, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "チャンスカードマスに止まった際、追加でチャンスカードを一枚ひける。", "id": "p9"},
    {"name": "星燐 喜夫", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 12, "sci": 0, "env": 0, "non": 0}, "eff": "（１）このカードは首班指名されたプレーヤーでないと使用できない。 （２）このカードが首相になったとき、チャンスカードを4枚引く （３）政治家獲得マスを通る度、この政党でこのカードの次に影響力が強い政治家カードを山札に送る", "id": "p10"},
    {"name": "毛沢 南", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 8, "sci": 0, "env": 0, "non": 0}, "eff": "（1）信用が０の時も、チャンスカードを使用できる。(2)インシデント「内戦」が起こるたび、チャンスカードを一枚引くことができる。（３）首相ではなくても、行政カードを使用できる。", "id": "p11"},
    {"name": "片山　徹", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 4, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p12"},
    {"name": "芦田　仁", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 4, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p13"},
    {"name": "徳田　球児", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 4, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p14"},
    {"name": "幸徳冬水", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 4, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p15"},
    {"name": "村山　富二", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p16"},
    {"name": "不破　哲二", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 3, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p17"},
    {"name": "水井　たか子", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 3, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p18"},
    {"name": "福岡　みすず", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 3, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p19"},
    {"name": "無所属議員1", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 1, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p20"},
    {"name": "無所属議員2", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 1, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p21"},
    {"name": "加流部　人良", "ideo": "mil", "infl": {"cap": 0, "mil": 7, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "（１）このカードが党首になった時、信用度を＋５する。（２）このカードが首相になった際、成立している法案・政策カードを全て捨て山に送る。また、このカードが首相である限り、他プレーヤーは法案・政策カードを提出できなり。（３）このカードが首相で有る限り、首班指名選挙は行われない。", "id": "p22"},
    {"name": "夢想　利一", "ideo": "mil", "infl": {"cap": 0, "mil": 6, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p23"},
    {"name": "沖田　鉄山", "ideo": "mil", "infl": {"cap": 0, "mil": 5, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p24"},
    {"name": "石岡　莞爾", "ideo": "mil", "infl": {"cap": 0, "mil": 5, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p25"},
    {"name": "北条　英樹", "ideo": "mil", "infl": {"cap": 0, "mil": 4, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p26"},
    {"name": "畿内　光政", "ideo": "mil", "infl": {"cap": 0, "mil": 4, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p27"},
    {"name": "山梨　権兵衛", "ideo": "mil", "infl": {"cap": 0, "mil": 4, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p28"},
    {"name": "南園寺　公望", "ideo": "mil", "infl": {"cap": 0, "mil": 3, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p29"},
    {"name": "新潟　有朋", "ideo": "mil", "infl": {"cap": 0, "mil": 3, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p30"},
    {"name": "桂木　次郎", "ideo": "mil", "infl": {"cap": 0, "mil": 3, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p31"},
    {"name": "無所属議員3", "ideo": "mil", "infl": {"cap": 0, "mil": 2, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p32"},
    {"name": "無所属議員4", "ideo": "mil", "infl": {"cap": 0, "mil": 2, "com": 0, "sci": 0, "env": 0, "non": 0}, "eff": "", "id": "p33"},
    {"name": "武欄　栗男", "ideo": "sci", "infl": {"cap": 2, "mil": 0, "com": 0, "sci": 4, "env": 0, "non": 0}, "eff": "（１）このカードが党首になった際、信用度を＋５する。 （２）このカードが党首である場合、チャンスカードを加えて一枚引く事ができる。 （３）このカードが首相になっている間、インシデントが発生するたびに科学主義イデオロギーが＋１される。", "id": "p34"},
    {"name": "榎本　松秋", "ideo": "mil", "infl": {"cap": 0, "mil": 2, "com": 0, "sci": 2, "env": 0, "non": 0}, "eff": "", "id": "p35"},
    {"name": "琢磨　象山", "ideo": "mil", "infl": {"cap": 0, "mil": 2, "com": 0, "sci": 2, "env": 0, "non": 0}, "eff": "", "id": "p36"},
    {"name": "福本　諭吉", "ideo": "com", "infl": {"cap": 0, "mil": 0, "com": 2, "sci": 2, "env": 0, "non": 0}, "eff": "", "id": "p37"},
    {"name": "三科　芳雄", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 2, "env": 1, "non": 0}, "eff": "", "id": "p38"},
    {"name": "南里　柴三郎", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 1, "sci": 2, "env": 0, "non": 0}, "eff": "", "id": "p39"},
    {"name": "有村　行亜", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 6, "non": 0}, "eff": "（１）このカードが党首になった際、このカードの影響力は、場に出ている他の環境主義者１名につき＋１される。（２）このカードが首相になった際、信用度が＋５される。 （３）このカードが首相である時、インシデントカードが引かれた際に一回に限りそれを発生させず、もう一枚引かせる事ができる。", "id": "p40"},
    {"name": "鹿村　礼子", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 4, "non": 0}, "eff": "環境インシデントが生じた際に追加で１環境イデオロギーポイントを得る。", "id": "p41"},
    {"name": "田中　泰造", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 4, "non": 0}, "eff": "政治の山札が切られるたびに１イデオロギーポイントを得る", "id": "p42"},
    {"name": "西方　熊楠", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 3, "env": 0, "non": 0}, "eff": "", "id": "p43"},
    {"name": "大澤　一郎", "ideo": "non", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 10}, "eff": "（１）このカードは政治家獲得マスで他の政治家を得た際に交換の対象にできない  （２）このカードが党首の場合、首相指名選挙に立候補できない。", "id": "p44"},
    {"name": "天和", "ideo": "non", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 7}, "eff": "このカードが党首の時には、政令カードを使用する事ができない。", "id": "p45"},
    {"name": "端本　哲夫", "ideo": "non", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 8}, "eff": "", "id": "p46"},
    {"name": "無所属議員5", "ideo": "non", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 3}, "eff": "", "id": "p47"},
    {"name": "無所属議員6", "ideo": "non", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0, "non": 3}, "eff": "", "id": "p48"},
    {"name": "湯川　秀彦", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 8, "env": 0, "non": 0}, "eff": "", "id": "p49"},
    {"name": "朝長　振太", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 5, "env": 0, "non": 0}, "eff": "", "id": "p50"},
    {"name": "江崎　礼於", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 4, "env": 0, "non": 0}, "eff": "", "id": "p51"},
    {"name": "利根河　進", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 4, "env": 1, "non": 0}, "eff": "", "id": "p52"},
    {"name": "白河　英樹", "ideo": "sci", "infl": {"cap": 1, "mil": 0, "com": 0, "sci": 4, "env": 0, "non": 0}, "eff": "", "id": "p53"},
    {"name": "野依　良太", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 3, "env": 0, "non": 0}, "eff": "", "id": "p54"},
    {"name": "大隅　良則", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 3, "env": 0, "non": 0}, "eff": "", "id": "p55"},
    {"name": "本庶　佑一", "ideo": "sci", "infl": {"cap": 0, "mil": 0, "com": 1, "sci": 2, "env": 0, "non": 0}, "eff": "", "id": "p56"},
    {"name": "石牟礼　道緒", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 8, "non": 0}, "eff": "", "id": "p57"},
    {"name": "田中　正臓", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 1, "sci": 0, "env": 6, "non": 0}, "eff": "", "id": "p58"},
    {"name": "宮脇　昭一", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 1, "env": 5, "non": 0}, "eff": "", "id": "p59"},
    {"name": "屋久　杉夫", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 4, "non": 0}, "eff": "", "id": "p60"},
    {"name": "苗場　緑", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 4, "non": 0}, "eff": "", "id": "p61"},
    {"name": "尾瀬　沼子", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 3, "non": 0}, "eff": "", "id": "p62"},
    {"name": "熊野　樹里", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 1, "env": 2, "non": 0}, "eff": "", "id": "p63"},
    {"name": "河野　みどり", "ideo": "env", "infl": {"cap": 1, "mil": 0, "com": 0, "sci": 0, "env": 2, "non": 0}, "eff": "", "id": "p64"},
    {"name": "白神　郷", "ideo": "env", "infl": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 1, "non": 0}, "eff": "", "id": "p65"},
  ];

  var CHANCES = [
    {"name": "不信任決議", "eff": "このカードを使うと直ちに首班指名選挙が行われる", "cost": -2, "admin": 0, "id": "c0"},
    {"name": "襲撃", "eff": "次のターン対象のプレーヤーは行動不能となる", "cost": -2, "admin": 0, "id": "c1"},
    {"name": "行財政改革", "eff": "使用者の信用を＋３する", "cost": 0, "admin": 1, "id": "c2"},
    {"name": "恩赦", "eff": "捨て山にある政治家を任意に選んで一枚政党に加える事ができる。", "cost": -1, "admin": 1, "id": "c3"},
    {"name": "スキャンダル", "eff": "対象のプレーヤーの政治家一枚を捨て山に送る", "cost": -1, "admin": 0, "id": "c4"},
    {"name": "包囲網", "eff": "一番大きな影響力を有するプレーヤーはチャンスカードを全て捨てる。", "cost": -2, "admin": 0, "id": "c5"},
    {"name": "連合", "eff": "このカードをプレイしたプレーヤーはその他の一人のプレーヤーを選択する。選択されたプレーヤーは、渡欧表をこのカードのプレーヤーと同じくする。", "cost": -1, "admin": 0, "id": "c6"},
    {"name": "牛歩戦術", "eff": "各プレーヤーは次の首班指名選挙まで１しか進めない。", "cost": -1, "admin": 0, "id": "c7"},
    {"name": "静観", "eff": "このカードは、サイコロを振る前にしようしなければならない。プレイしたプレーヤーは、このターン行動不能になる代わりに、このターンチャンスカード及びインシデントカードの効果対象にならない。", "cost": -1, "admin": 0, "id": "c8"},
    {"name": "転向", "eff": "対象のプレーヤーの政治家一枚を獲得することができる。対象のプレーヤーは山札から３枚政治家カードを引きそのうち１枚を手札に加える。", "cost": -5, "admin": 0, "id": "c9"},
    {"name": "政治献金", "eff": "チャンスカードを１枚得る。", "cost": -1, "admin": 0, "id": "c10"},
    {"name": "名演説", "eff": "法案・政策カードを一枚引く", "cost": 0, "admin": 0, "id": "c11"},
    {"name": "機関紙発行", "eff": "政治家カードを2枚ひき手持ちに加えてもよい", "cost": -1, "admin": 0, "id": "c12"},
    {"name": "一日天下", "eff": "次のターン、首班として行動する事ができる", "cost": -2, "admin": 0, "id": "c13"},
    {"name": "暗殺", "eff": "対象のプレーヤーの政治家一名を山札に送る", "cost": -5, "admin": 0, "id": "c14"},
    {"name": "財政の崖", "eff": "次のターンの終わりまでチャンスカードを引く事ができない。", "cost": -1, "admin": 0, "id": "c15"},
    {"name": "世論操作", "eff": "任意のイデオロギーを任意の方向に＋２する。", "cost": -1, "admin": 1, "id": "c16"},
    {"name": "均衡", "eff": "対象のプレーヤー一名を選ぶ、そのプレーヤーと同じ信用になる。", "cost": 0, "admin": 0, "id": "c17"},
    {"name": "決闘", "eff": "このターン、法案・政策への投票はこのカードをプレイしたプレーヤーと、このカードをプレイしたプレーヤーが選んだプレーヤーしか投票する事ができない。", "cost": -1, "admin": 0, "id": "c18"},
    {"name": "集中審議", "eff": "このターン、法案・政策カードは場の全影響力の2/3の信任を得ていなければ、成立しない。", "cost": 0, "admin": 0, "id": "c19"},
    {"name": "讒言", "eff": "対象のプレイヤーの信用度を−２する", "cost": -2, "admin": 0, "id": "c20"},
    {"name": "陳情", "eff": "対象のプレーヤーの信用度を−４する", "cost": -3, "admin": 0, "id": "c21"},
    {"name": "ねずみとり", "eff": "対象のプレーヤーの一番影響力の低い政治家を捨て山に送る。", "cost": -3, "admin": 0, "id": "c22"},
  ];

  var INCIDENTS = [
    {"name": "ゴールドラッシュ", "eff": "各プレーヤーともチャンスカードを２枚引く", "d": {"cap": 2, "mil": -1, "com": -1, "sci": 1, "env": 0}, "id": "i0"},
    {"name": "万国博覧会", "eff": "各プレーヤーともチャンスカードを1枚引く", "d": {"cap": 1, "mil": -1, "com": 0, "sci": 1, "env": 1}, "id": "i1"},
    {"name": "大恐慌", "eff": "チャンスカードを半分捨てる", "d": {"cap": -2, "mil": 0, "com": 2, "sci": -1, "env": 0}, "id": "i2"},
    {"name": "世界大戦", "eff": "全てのプレーヤーはチャンスカードを全て捨てる。現首班は下野し、合計影響力が一番小さいプレーヤーが首班に指名される。", "d": {"cap": -3, "mil": 3, "com": 1, "sci": 1, "env": 1}, "id": "i3"},
    {"name": "大震災", "eff": "全てのプレーヤーはチャンスカードを全て失う。", "d": {"cap": -3, "mil": 2, "com": 1, "sci": 1, "env": -1}, "id": "i4"},
    {"name": "大干ばつ", "eff": "", "d": {"cap": -2, "mil": 0, "com": 2, "sci": 0, "env": 1}, "id": "i5"},
    {"name": "豊作", "eff": "", "d": {"cap": 1, "mil": 0, "com": -1, "sci": 1, "env": 1}, "id": "i6"},
    {"name": "内戦", "eff": "各プレーヤーともチャンスカードを一枚捨てる。もう一枚インシデントカードを引く。", "d": {"cap": -3, "mil": 1, "com": 2, "sci": 1, "env": 0}, "id": "i7"},
    {"name": "流行", "eff": "影響力が一番大きいプレーヤーは1枚チャンスカードを引く。", "d": {"cap": 2, "mil": 0, "com": -2, "sci": 0, "env": 0}, "id": "i8"},
    {"name": "大津波", "eff": "", "d": {"cap": -2, "mil": 1, "com": 1, "sci": 1, "env": 1}, "id": "i9"},
    {"name": "ゼネラルストライキ", "eff": "", "d": {"cap": -2, "mil": 0, "com": 2, "sci": 0, "env": 0}, "id": "i10"},
    {"name": "情報化社会", "eff": "", "d": {"cap": 1, "mil": -1, "com": -1, "sci": 1, "env": 0}, "id": "i11"},
    {"name": "大社交界", "eff": "", "d": {"cap": 1, "mil": 0, "com": -1, "sci": 1, "env": 1}, "id": "i12"},
    {"name": "外圧", "eff": "", "d": {"cap": 1, "mil": 1, "com": -2, "sci": 1, "env": 0}, "id": "i13"},
    {"name": "化学の世紀", "eff": "", "d": {"cap": 1, "mil": -1, "com": 0, "sci": 1, "env": 0}, "id": "i14"},
    {"name": "電力網の発展", "eff": "", "d": {"cap": 1, "mil": 0, "com": -1, "sci": 1, "env": 0}, "id": "i15"},
    {"name": "テロリズム", "eff": "", "d": {"cap": -2, "mil": 1, "com": 1, "sci": -1, "env": 0}, "id": "i16"},
    {"name": "世代交代", "eff": "", "d": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0}, "id": "i17"},
    {"name": "クーデター", "eff": "", "d": {"cap": -1, "mil": 2, "com": -1, "sci": 0, "env": 0}, "id": "i18"},
    {"name": "グローバル化", "eff": "", "d": {"cap": 2, "mil": -1, "com": -1, "sci": 1, "env": 1}, "id": "i19"},
    {"name": "快楽主義の広まり", "eff": "", "d": {"cap": 1, "mil": 0, "com": -1, "sci": 0, "env": 1}, "id": "i20"},
    {"name": "平和な1日", "eff": "", "d": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 1}, "id": "i21"},
    {"name": "平和な1日", "eff": "", "d": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 1}, "id": "i22"},
  ];

  var LAWS = [
    {"name": "新世代兵器の開発", "d": {"cap": -1, "mil": 2, "com": -1, "sci": 1, "env": 0}, "pip": 2, "aip": 1, "eff": "", "id": "l0"},
    {"name": "バイオエコロジー技術の開発", "d": {"cap": 1, "mil": -1, "com": 0, "sci": 1, "env": 2}, "pip": 2, "aip": 2, "eff": "", "id": "l1"},
    {"name": "家電リサイクル法", "d": {"cap": -1, "mil": 0, "com": 1, "sci": 1, "env": 2}, "pip": 1, "aip": 0, "eff": "", "id": "l2"},
    {"name": "ユートピアの建設", "d": {"cap": -1, "mil": -1, "com": 2, "sci": 1, "env": 1}, "pip": 2, "aip": 1, "eff": "", "id": "l3"},
    {"name": "科学的管理法の導入", "d": {"cap": 0, "mil": -2, "com": 2, "sci": 2, "env": 2}, "pip": 2, "aip": 1, "eff": "", "id": "l4"},
    {"name": "公職追放", "d": {"cap": 1, "mil": 1, "com": -2, "sci": 0, "env": 0}, "pip": 2, "aip": 1, "eff": "共産主義の影響力が一番大きいプレーヤーは、法案を提出する事ができない", "id": "l5"},
    {"name": "2大政党制", "d": {"cap": 2, "mil": -1, "com": -1, "sci": 0, "env": 0}, "pip": 2, "aip": 1, "eff": "投票は影響力が一番多いプレーヤー、2番目に多いプレーヤーしかできなくなる", "id": "l6"},
    {"name": "赤軍の設立", "d": {"cap": -1, "mil": -1, "com": 2, "sci": 0, "env": 0}, "pip": 2, "aip": 1, "eff": "政治家獲得マスで、首班だけ3枚引き、他は2枚引く", "id": "l7"},
    {"name": "独占禁止法", "d": {"cap": -2, "mil": 0, "com": 2, "sci": 0, "env": 1}, "pip": 2, "aip": 1, "eff": "チャンスカードを1枚までしか持てなくなる", "id": "l8"},
    {"name": "官僚制国家", "d": {"cap": 0, "mil": 0, "com": 0, "sci": 0, "env": 0}, "pip": 1, "aip": 1, "eff": "首班指名されているプレーヤーは、チャンスカードを引く際2枚引く", "id": "l9"},
    {"name": "中央情報局", "d": {"cap": 0, "mil": 1, "com": -1, "sci": 1, "env": 0}, "pip": 0, "aip": 0, "eff": "", "id": "l10"},
    {"name": "累進課税", "d": {"cap": -1, "mil": 1, "com": 0, "sci": 0, "env": 1}, "pip": 1, "aip": 1, "eff": "", "id": "l11"},
    {"name": "統制経済", "d": {"cap": -2, "mil": 1, "com": 1, "sci": 0, "env": 0}, "pip": 1, "aip": 0, "eff": "", "id": "l12"},
    {"name": "治安維持法", "d": {"cap": 0, "mil": 2, "com": -2, "sci": 0, "env": 0}, "pip": 1, "aip": 0, "eff": "", "id": "l13"},
    {"name": "体制翼賛選挙", "d": {"cap": -1, "mil": 2, "com": -1, "sci": 0, "env": 0}, "pip": 1, "aip": 0, "eff": "", "id": "l14"},
    {"name": "検閲", "d": {"cap": 0, "mil": 1, "com": -1, "sci": -1, "env": -1}, "pip": 1, "aip": 0, "eff": "", "id": "l15"},
    {"name": "軍産複合体", "d": {"cap": 1, "mil": 1, "com": -2, "sci": 1, "env": 0}, "pip": 1, "aip": 0, "eff": "", "id": "l16"},
    {"name": "高速道路建設", "d": {"cap": 1, "mil": 1, "com": -2, "sci": 1, "env": 1}, "pip": 1, "aip": 0, "eff": "", "id": "l17"},
    {"name": "高速鉄道計画", "d": {"cap": 1, "mil": 1, "com": -2, "sci": 1, "env": 1}, "pip": 1, "aip": 0, "eff": "", "id": "l18"},
    {"name": "文民統制", "d": {"cap": 2, "mil": -2, "com": 0, "sci": 0, "env": 0}, "pip": 2, "aip": 1, "eff": "この法律が成立している限り、軍国主義の政治家は首相になれない", "id": "l19"},
  ];

  var DATA = {
    IDEOLOGIES: IDEOLOGIES,
    WIN_IP: WIN_IP,
    IDEO_WEIGHT: IDEO_WEIGHT,
    BOARD: BOARD,
    BASIC_POLICIES: BASIC_POLICIES,
    PLAYER_COLORS: PLAYER_COLORS,
    PLAYER_COLOR_NAMES: PLAYER_COLOR_NAMES,
    POLITICIANS: POLITICIANS,
    CHANCES: CHANCES,
    INCIDENTS: INCIDENTS,
    LAWS: LAWS
  };

  root.PL_DATA = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);

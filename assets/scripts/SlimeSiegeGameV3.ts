import {
    _decorator,
    Component,
    Node,
    Graphics,
    Color,
    UITransform,
    input,
    Input,
    EventTouch,
    EventKeyboard,
    KeyCode,
    Vec3,
    Label,
    HorizontalTextAlignment,
    VerticalTextAlignment,
    Sprite,
    SpriteFrame,
    resources,
    view,
    ResolutionPolicy,
} from 'cc';

const { ccclass } = _decorator;

type SlimeSpecies = 'green' | 'blue' | 'purple' | 'spike' | 'red';
type EnemyRank = 'normal' | 'elite' | 'boss';
type BoostKind = 'damage' | 'attackSpeed' | 'multiShot' | 'heal' | 'blade' | 'magnet';
type UpgradeKind = 'damage' | 'attackSpeed' | 'multiShot' | 'moveSpeed' | 'slashSpeed' | 'pierce' | 'magnet' | 'blade';
type PlayerAnimState = 'idle' | 'walk';

type EnemyData = {
    node: Node;
    visual: Node;
    sprite: Sprite;
    species: SlimeSpecies;
    rank: EnemyRank;
    frames: SpriteFrame[];
    animTimer: number;
    animIndex: number;
    hp: number;
    maxHp: number;
    speed: number;
    radius: number;
    xp: number;
    phase: number;
    hitPulse: number;
};

type SlashData = {
    node: Node;
    dir: Vec3;
    speed: number;
    radius: number;
    life: number;
    damage: number;
    pierceLeft: number;
};

type PickupData = {
    node: Node;
    kind: 'xp' | 'boost';
    boostKind?: BoostKind;
    value: number;
    radius: number;
};

type UpgradeChoice = {
    kind: UpgradeKind;
    title: string;
    desc: string;
};

@ccclass('SlimeSiegeGame')
export class SlimeSiegeGame extends Component {
    private readonly width = 1280;
    private readonly height = 720;

    private root!: Node;
    private worldLayer!: Node;
    private uiLayer!: Node;
    private player!: Node;
    private playerVisual!: Node;
    private playerSprite!: Sprite;

    private playerIdleFrames: SpriteFrame[] = [];
    private playerWalkFrames: SpriteFrame[] = [];
    private slimeFrames = new Map<SlimeSpecies, SpriteFrame[]>();
    private artReady = false;

    private playerAnimState: PlayerAnimState = 'idle';
    private playerAnimTimer = 0;
    private playerAnimIndex = 0;
    private playerFacing = 1;

    private scoreLabel!: Label;
    private timeLabel!: Label;
    private hpLabel!: Label;
    private levelLabel!: Label;
    private helpLabel!: Label;
    private buffLabel!: Label;
    private loadingLabel!: Label;
    private gameOverOverlay!: Node;
    private gameOverLabel!: Label;

    private upgradeOverlay!: Node;
    private upgradeTitle!: Label;
    private upgradeCards: Label[] = [];
    private upgradeCardCenters = [-340, 0, 340];
    private currentChoices: UpgradeChoice[] = [];

    private enemies: EnemyData[] = [];
    private slashes: SlashData[] = [];
    private pickups: PickupData[] = [];
    private bladeNodes: Node[] = [];

    private playerTarget = new Vec3(0, -30, 0);
    private pressedKeys = new Set<KeyCode>();
    private playerSpeed = 330;
    private playerRadius = 28;
    private playerHp = 4;
    private playerMaxHp = 4;
    private invulnerableTimer = 0;

    private spawnTimer = 0;
    private spawnInterval = 0.66;
    private eliteTimer = 20;
    private bossTimer = 72;
    private shootTimer = 0;
    private shootInterval = 0.58;

    private slashDamage = 1;
    private slashSpeed = 620;
    private slashRadius = 17;
    private slashPierce = 0;
    private multiShot = 1;
    private pickupRadius = 105;

    private bladeCount = 0;
    private bladeRadius = 86;
    private bladeDamage = 1;
    private bladeHitTimer = 0;

    private elapsed = 0;
    private kills = 0;
    private eliteKills = 0;
    private bossKills = 0;
    private level = 1;
    private xp = 0;
    private xpToNext = 8;

    private isGameOver = false;
    private isChoosingUpgrade = false;
    private buffMessageTimer = 0;

    onLoad() {
        view.setDesignResolutionSize(this.width, this.height, ResolutionPolicy.SHOW_ALL);
        this.buildScene();
        this.registerInput();
        void this.loadArt();
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private registerInput() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private async loadArt() {
        try {
            const idlePaths = Array.from({ length: 8 }, (_, i) => `player/idle/idle_${String(i + 1).padStart(2, '0')}/spriteFrame`);
            const walkPaths = Array.from({ length: 8 }, (_, i) => `player/walk/walk_${String(i + 1).padStart(2, '0')}/spriteFrame`);
            this.playerIdleFrames = await this.loadFrameList(idlePaths);
            this.playerWalkFrames = await this.loadFrameList(walkPaths);

            const species: SlimeSpecies[] = ['green', 'blue', 'purple', 'spike', 'red'];
            for (const s of species) {
                const paths = Array.from({ length: 4 }, (_, i) => `slimes/${s}/${s}_${String(i + 1).padStart(2, '0')}/spriteFrame`);
                this.slimeFrames.set(s, await this.loadFrameList(paths));
            }

            const grass = await this.loadSpriteFrame('background/grass/spriteFrame');
            this.applyBackground(grass);

            this.artReady = true;
            this.loadingLabel.node.active = false;
            this.playerSprite.spriteFrame = this.playerIdleFrames[0] ?? null;
            this.showBuffMessage('史莱姆围城 · 横屏测试版');
        } catch (err) {
            console.error('[SlimeSiege] 美术资源加载失败：', err);
            this.loadingLabel.string = '资源加载失败，请检查 assets/resources 文件夹';
        }
    }

    private loadFrameList(paths: string[]): Promise<SpriteFrame[]> {
        return Promise.all(paths.map(path => this.loadSpriteFrame(path)));
    }

    private loadSpriteFrame(path: string): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            resources.load(path, SpriteFrame, (err, frame) => {
                if (err || !frame) {
                    reject(err ?? new Error(`无法加载：${path}`));
                    return;
                }
                resolve(frame);
            });
        });
    }

    private buildScene() {
        this.root = this.node;
        const rootUI = this.root.getComponent(UITransform) ?? this.root.addComponent(UITransform);
        rootUI.setContentSize(this.width, this.height);

        this.worldLayer = new Node('World');
        this.root.addChild(this.worldLayer);
        this.worldLayer.addComponent(UITransform).setContentSize(this.width, this.height);

        this.buildFallbackBackground();
        this.buildPlayer();

        this.uiLayer = new Node('UI');
        this.root.addChild(this.uiLayer);
        this.uiLayer.addComponent(UITransform).setContentSize(this.width, this.height);

        this.buildHUD();
        this.buildUpgradeOverlay();
        this.buildGameOverOverlay();
        this.refreshBlades();
    }

    private buildFallbackBackground() {
        const bg = new Node('Background');
        this.worldLayer.addChild(bg);
        bg.setSiblingIndex(0);
        bg.addComponent(UITransform).setContentSize(this.width, this.height);
        const g = bg.addComponent(Graphics);
        g.fillColor = new Color(106, 166, 82, 255);
        g.rect(-this.width / 2, -this.height / 2, this.width, this.height);
        g.fill();
        g.fillColor = new Color(78, 139, 68, 120);
        for (let i = 0; i < 100; i++) {
            const x = -this.width / 2 + 20 + Math.random() * (this.width - 40);
            const y = -this.height / 2 + 20 + Math.random() * (this.height - 40);
            g.circle(x, y, 2 + Math.random() * 3);
            g.fill();
        }
    }

    private applyBackground(frame: SpriteFrame) {
        const old = this.worldLayer.getChildByName('Background');
        if (old?.isValid) old.destroy();
        const bg = new Node('Background');
        this.worldLayer.addChild(bg);
        bg.setSiblingIndex(0);
        bg.addComponent(UITransform).setContentSize(this.width, this.height);
        const sprite = bg.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
    }

    private buildPlayer() {
        this.player = new Node('Player');
        this.worldLayer.addChild(this.player);
        this.player.addComponent(UITransform).setContentSize(82, 108);
        this.player.setPosition(0, -40, 0);
        this.playerTarget.set(this.player.position);

        this.playerVisual = new Node('Visual');
        this.player.addChild(this.playerVisual);
        this.playerVisual.addComponent(UITransform).setContentSize(118, 150);
        this.playerSprite = this.playerVisual.addComponent(Sprite);
        this.playerSprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const shadow = new Node('Shadow');
        this.player.addChild(shadow);
        shadow.setSiblingIndex(0);
        shadow.setPosition(0, -47, 0);
        shadow.addComponent(UITransform).setContentSize(64, 18);
        const sg = shadow.addComponent(Graphics);
        sg.fillColor = new Color(22, 49, 35, 80);
        sg.ellipse(0, 0, 32, 9);
        sg.fill();
    }

    private buildHUD() {
        const topBar = new Node('TopBar');
        this.uiLayer.addChild(topBar);
        topBar.setPosition(0, this.height / 2 - 42, 0);
        topBar.addComponent(UITransform).setContentSize(this.width - 48, 64);
        const tg = topBar.addComponent(Graphics);
        tg.fillColor = new Color(20, 39, 42, 205);
        tg.roundRect(-(this.width - 48) / 2, -32, this.width - 48, 64, 20);
        tg.fill();
        tg.strokeColor = new Color(242, 207, 105, 180);
        tg.lineWidth = 2;
        tg.roundRect(-(this.width - 48) / 2, -32, this.width - 48, 64, 20);
        tg.stroke();

        this.hpLabel = this.makeLabel(this.uiLayer, 'HpLabel', '生命 ♥♥♥♥', 23, -470, this.height / 2 - 42, 260, 54);
        this.timeLabel = this.makeLabel(this.uiLayer, 'TimeLabel', '00:00', 28, 0, this.height / 2 - 42, 180, 54);
        this.scoreLabel = this.makeLabel(this.uiLayer, 'ScoreLabel', '击杀 0', 22, 455, this.height / 2 - 42, 300, 54);

        const expBg = new Node('ExpBar');
        this.uiLayer.addChild(expBg);
        expBg.setPosition(0, -this.height / 2 + 38, 0);
        expBg.addComponent(UITransform).setContentSize(540, 34);
        const eg = expBg.addComponent(Graphics);
        eg.fillColor = new Color(21, 39, 39, 210);
        eg.roundRect(-270, -17, 540, 34, 17);
        eg.fill();
        eg.strokeColor = new Color(242, 207, 105, 160);
        eg.lineWidth = 2;
        eg.roundRect(-270, -17, 540, 34, 17);
        eg.stroke();

        this.levelLabel = this.makeLabel(this.uiLayer, 'LevelLabel', 'LV.1   EXP 0/8', 20, 0, -this.height / 2 + 38, 500, 34);
        this.helpLabel = this.makeLabel(this.uiLayer, 'HelpLabel', '点击/拖动移动 · WASD也可移动 · 自动释放剑气', 17, -405, -this.height / 2 + 37, 370, 46);
        this.helpLabel.color = new Color(238, 248, 226, 210);

        this.buffLabel = this.makeLabel(this.uiLayer, 'BuffLabel', '', 24, 0, 245, 760, 62);
        this.buffLabel.color = new Color(255, 244, 174, 255);
        this.buffLabel.node.active = false;

        this.loadingLabel = this.makeLabel(this.uiLayer, 'LoadingLabel', '正在载入角色与史莱姆动画…', 26, 0, 0, 650, 80);
        this.loadingLabel.color = new Color(255, 248, 216, 255);
    }

    private buildUpgradeOverlay() {
        this.upgradeOverlay = new Node('UpgradeOverlay');
        this.uiLayer.addChild(this.upgradeOverlay);
        this.upgradeOverlay.addComponent(UITransform).setContentSize(this.width, this.height);
        const g = this.upgradeOverlay.addComponent(Graphics);
        g.fillColor = new Color(12, 22, 29, 225);
        g.rect(-this.width / 2, -this.height / 2, this.width, this.height);
        g.fill();

        this.upgradeTitle = this.makeLabel(this.upgradeOverlay, 'UpgradeTitle', '升级！选择一个强化', 34, 0, 235, 700, 72);
        this.upgradeTitle.color = new Color(255, 229, 128, 255);

        for (let i = 0; i < 3; i++) {
            const card = new Node(`UpgradeCard${i}`);
            this.upgradeOverlay.addChild(card);
            card.setPosition(this.upgradeCardCenters[i], -5, 0);
            card.addComponent(UITransform).setContentSize(300, 230);
            const cg = card.addComponent(Graphics);
            cg.fillColor = new Color(32, 55, 59, 250);
            cg.roundRect(-150, -115, 300, 230, 22);
            cg.fill();
            cg.strokeColor = new Color(243, 205, 102, 230);
            cg.lineWidth = 3;
            cg.roundRect(-150, -115, 300, 230, 22);
            cg.stroke();
            const label = this.makeLabel(card, 'CardLabel', '', 23, 0, 0, 270, 200);
            this.upgradeCards.push(label);
        }

        const tip = this.makeLabel(this.upgradeOverlay, 'UpgradeTip', '点击卡片选择 · 游戏会暂停', 18, 0, -185, 550, 44);
        tip.color = new Color(211, 226, 226, 220);
        this.upgradeOverlay.active = false;
    }

    private buildGameOverOverlay() {
        this.gameOverOverlay = new Node('GameOverOverlay');
        this.uiLayer.addChild(this.gameOverOverlay);
        this.gameOverOverlay.addComponent(UITransform).setContentSize(this.width, this.height);
        const g = this.gameOverOverlay.addComponent(Graphics);
        g.fillColor = new Color(10, 19, 25, 220);
        g.rect(-this.width / 2, -this.height / 2, this.width, this.height);
        g.fill();

        const panel = new Node('Panel');
        this.gameOverOverlay.addChild(panel);
        panel.addComponent(UITransform).setContentSize(650, 380);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = new Color(29, 50, 54, 250);
        pg.roundRect(-325, -190, 650, 380, 28);
        pg.fill();
        pg.strokeColor = new Color(242, 207, 105, 225);
        pg.lineWidth = 3;
        pg.roundRect(-325, -190, 650, 380, 28);
        pg.stroke();

        this.gameOverLabel = this.makeLabel(panel, 'GameOverLabel', '', 28, 0, 5, 590, 330);
        this.gameOverOverlay.active = false;
    }

    private makeLabel(parent: Node, name: string, text: string, fontSize: number, x: number, y: number, w: number, h: number): Label {
        const n = new Node(name);
        parent.addChild(n);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 8;
        label.color = Color.WHITE;
        label.horizontalAlign = HorizontalTextAlignment.CENTER;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        return label;
    }

    private onTouchStart(event: EventTouch) {
        if (this.isGameOver) {
            this.restartGame();
            return;
        }
        if (this.isChoosingUpgrade) {
            this.chooseUpgradeByTouch(event);
            return;
        }
        this.setMoveTarget(event);
    }

    private onTouchMove(event: EventTouch) {
        if (this.isGameOver || this.isChoosingUpgrade) return;
        this.setMoveTarget(event);
    }

    private setMoveTarget(event: EventTouch) {
        const p = event.getUILocation();
        this.playerTarget.set(p.x - this.width / 2, p.y - this.height / 2, 0);
        const marginX = this.width / 2 - 48;
        const marginY = this.height / 2 - 70;
        this.playerTarget.x = Math.max(-marginX, Math.min(marginX, this.playerTarget.x));
        this.playerTarget.y = Math.max(-marginY, Math.min(marginY, this.playerTarget.y));
    }

    private onKeyDown(event: EventKeyboard) {
        this.pressedKeys.add(event.keyCode);
    }

    private onKeyUp(event: EventKeyboard) {
        this.pressedKeys.delete(event.keyCode);
    }

    private getKeyboardDirection(): Vec3 {
        let x = 0;
        let y = 0;
        if (this.pressedKeys.has(KeyCode.KEY_A) || this.pressedKeys.has(KeyCode.ARROW_LEFT)) x -= 1;
        if (this.pressedKeys.has(KeyCode.KEY_D) || this.pressedKeys.has(KeyCode.ARROW_RIGHT)) x += 1;
        if (this.pressedKeys.has(KeyCode.KEY_W) || this.pressedKeys.has(KeyCode.ARROW_UP)) y += 1;
        if (this.pressedKeys.has(KeyCode.KEY_S) || this.pressedKeys.has(KeyCode.ARROW_DOWN)) y -= 1;
        if (x !== 0 || y !== 0) {
            const len = Math.sqrt(x * x + y * y);
            x /= len;
            y /= len;
        }
        return new Vec3(x, y, 0);
    }

    private chooseUpgradeByTouch(event: EventTouch) {
        const p = event.getUILocation();
        const x = p.x - this.width / 2;
        const y = p.y - this.height / 2;
        if (Math.abs(y + 5) > 125) return;
        for (let i = 0; i < 3; i++) {
            if (Math.abs(x - this.upgradeCardCenters[i]) <= 155 && this.currentChoices[i]) {
                const choice = this.currentChoices[i];
                this.applyUpgrade(choice.kind);
                this.isChoosingUpgrade = false;
                this.upgradeOverlay.active = false;
                this.showBuffMessage(`升级获得：${choice.title}`);
                this.checkPendingLevelUp();
                return;
            }
        }
    }

    update(dt: number) {
        if (!this.artReady || this.isGameOver) return;

        if (this.buffMessageTimer > 0) {
            this.buffMessageTimer -= dt;
            if (this.buffMessageTimer <= 0) this.buffLabel.node.active = false;
        }
        if (this.isChoosingUpgrade) return;

        this.elapsed += dt;
        this.spawnTimer += dt;
        this.shootTimer += dt;
        this.eliteTimer -= dt;
        this.bossTimer -= dt;
        this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
        this.bladeHitTimer -= dt;

        this.updatePlayer(dt);
        this.updatePlayerAnimation(dt);

        if (this.spawnTimer >= this.spawnInterval) {
            this.spawnTimer -= this.spawnInterval;
            this.spawnEnemy('normal');
            this.spawnInterval = Math.max(0.23, 0.66 - this.elapsed * 0.0042);
        }

        if (this.eliteTimer <= 0) {
            this.spawnEnemy('elite');
            this.eliteTimer = Math.max(14, 23 - this.elapsed * 0.025) + Math.random() * 4;
            this.showBuffMessage('⚠ 精英史莱姆出现！击败会掉落稀有强化');
        }

        if (this.bossTimer <= 0) {
            this.spawnEnemy('boss');
            this.bossTimer = 92;
            this.showBuffMessage('⚠ 小Boss出现！目前暂用放大史莱姆占位');
        }

        if (this.shootTimer >= this.shootInterval) {
            this.shootTimer -= this.shootInterval;
            this.fireAtNearestEnemy();
        }

        this.updateEnemies(dt);
        this.updateSlashes(dt);
        this.updatePickups(dt);
        this.updateBlades(dt);
        this.updateUI();
    }

    private updatePlayer(dt: number) {
        const pos = this.player.position.clone();
        const keyDir = this.getKeyboardDirection();
        let moving = false;
        let dx = 0;
        let dy = 0;

        if (keyDir.x !== 0 || keyDir.y !== 0) {
            dx = keyDir.x;
            dy = keyDir.y;
            pos.x += dx * this.playerSpeed * dt;
            pos.y += dy * this.playerSpeed * dt;
            this.playerTarget.set(pos);
            moving = true;
        } else {
            const tx = this.playerTarget.x - pos.x;
            const ty = this.playerTarget.y - pos.y;
            const dist = Math.sqrt(tx * tx + ty * ty);
            if (dist > 3) {
                const step = Math.min(dist, this.playerSpeed * dt);
                dx = tx / dist;
                dy = ty / dist;
                pos.x += dx * step;
                pos.y += dy * step;
                moving = true;
            }
        }

        const marginX = this.width / 2 - 50;
        const marginY = this.height / 2 - 72;
        pos.x = Math.max(-marginX, Math.min(marginX, pos.x));
        pos.y = Math.max(-marginY, Math.min(marginY, pos.y));
        this.player.setPosition(pos);

        if (moving && Math.abs(dx) > 0.08) this.playerFacing = dx >= 0 ? 1 : -1;
        this.setPlayerAnimState(moving ? 'walk' : 'idle');

        const flash = this.invulnerableTimer > 0 && Math.floor(this.invulnerableTimer * 16) % 2 === 0;
        this.playerVisual.active = !flash;
    }

    private setPlayerAnimState(state: PlayerAnimState) {
        if (state === this.playerAnimState) return;
        this.playerAnimState = state;
        this.playerAnimTimer = 0;
        this.playerAnimIndex = 0;
    }

    private updatePlayerAnimation(dt: number) {
        const frames = this.playerAnimState === 'walk' ? this.playerWalkFrames : this.playerIdleFrames;
        if (frames.length === 0) return;
        const fps = this.playerAnimState === 'walk' ? 9 : 5;
        this.playerAnimTimer += dt;
        const frameDuration = 1 / fps;
        while (this.playerAnimTimer >= frameDuration) {
            this.playerAnimTimer -= frameDuration;
            this.playerAnimIndex = (this.playerAnimIndex + 1) % frames.length;
        }
        this.playerSprite.spriteFrame = frames[this.playerAnimIndex];
        this.playerVisual.setScale(this.playerFacing * 0.78, 0.78, 1);
    }

    private chooseSpecies(): SlimeSpecies {
        const pool: { s: SlimeSpecies; w: number }[] = [
            { s: 'green', w: 42 },
            { s: 'blue', w: this.elapsed > 10 ? 22 : 10 },
            { s: 'purple', w: this.elapsed > 20 ? 18 : 0 },
            { s: 'spike', w: this.elapsed > 34 ? 11 : 0 },
            { s: 'red', w: this.elapsed > 48 ? 13 : 0 },
        ];
        const total = pool.reduce((sum, p) => sum + p.w, 0);
        let roll = Math.random() * total;
        for (const p of pool) {
            roll -= p.w;
            if (roll <= 0) return p.s;
        }
        return 'green';
    }

    private spawnEnemy(rank: EnemyRank) {
        let species = this.chooseSpecies();
        if (rank === 'boss') species = Math.random() < 0.5 ? 'spike' : 'red';
        const frames = this.slimeFrames.get(species) ?? [];
        if (frames.length === 0) return;

        const node = new Node(`${rank}_${species}`);
        this.worldLayer.addChild(node);
        node.addComponent(UITransform).setContentSize(96, 90);

        const visual = new Node('Visual');
        node.addChild(visual);
        const sprite = visual.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frames[0];

        let visualW = 82;
        let visualH = 90;
        let hp = 3 + Math.floor(this.elapsed / 70);
        let speed = 88 + Math.min(45, this.elapsed * 0.42);
        let radius = 27;
        let xp = 1;

        switch (species) {
            case 'blue':
                visualW = 76; visualH = 91; hp = 2 + Math.floor(this.elapsed / 90); speed = 132 + Math.min(52, this.elapsed * 0.48); radius = 23; xp = 1;
                break;
            case 'purple':
                visualW = 84; visualH = 88; hp = 4 + Math.floor(this.elapsed / 65); speed = 96 + Math.min(38, this.elapsed * 0.35); radius = 28; xp = 2;
                break;
            case 'spike':
                visualW = 100; visualH = 94; hp = 8 + Math.floor(this.elapsed / 38); speed = 67 + Math.min(26, this.elapsed * 0.24); radius = 34; xp = 3;
                break;
            case 'red':
                visualW = 91; visualH = 90; hp = 5 + Math.floor(this.elapsed / 50); speed = 108 + Math.min(45, this.elapsed * 0.4); radius = 30; xp = 2;
                break;
        }
        visual.addComponent(UITransform).setContentSize(visualW, visualH);

        if (rank === 'elite') {
            hp = Math.max(15, hp * 5);
            speed *= 0.92;
            radius *= 1.45;
            xp = 8;
            visual.setScale(1.45, 1.45, 1);
            this.addAura(node, radius + 12, new Color(255, 207, 74, 150));
        } else if (rank === 'boss') {
            hp = 50 + Math.floor(this.elapsed / 20) * 5;
            speed = Math.min(speed * 0.68, 88);
            radius *= 1.9;
            xp = 22;
            visual.setScale(1.9, 1.9, 1);
            this.addAura(node, radius + 15, new Color(255, 102, 139, 170));
            const tag = this.makeLabel(node, 'BossTag', '小 BOSS', 15, 0, radius + 34, 130, 30);
            tag.color = new Color(255, 229, 138, 255);
        }

        const halfW = this.width / 2;
        const halfH = this.height / 2;
        const pad = rank === 'boss' ? 120 : 80;
        const side = Math.floor(Math.random() * 4);
        let x = 0;
        let y = 0;
        if (side === 0) { x = -halfW - pad; y = -halfH + Math.random() * this.height; }
        else if (side === 1) { x = halfW + pad; y = -halfH + Math.random() * this.height; }
        else if (side === 2) { x = -halfW + Math.random() * this.width; y = halfH + pad; }
        else { x = -halfW + Math.random() * this.width; y = -halfH - pad; }
        node.setPosition(x, y, 0);

        this.enemies.push({
            node, visual, sprite, species, rank, frames,
            animTimer: Math.random() * 0.5,
            animIndex: Math.floor(Math.random() * 4),
            hp, maxHp: hp, speed, radius, xp,
            phase: Math.random() * Math.PI * 2,
            hitPulse: 0,
        });
    }

    private addAura(parent: Node, radius: number, color: Color) {
        const aura = new Node('Aura');
        parent.addChild(aura);
        aura.setSiblingIndex(0);
        aura.addComponent(UITransform).setContentSize(radius * 2.2, radius * 2.2);
        const g = aura.addComponent(Graphics);
        g.strokeColor = color;
        g.lineWidth = 5;
        g.circle(0, -4, radius);
        g.stroke();
    }

    private updateEnemies(dt: number) {
        const pp = this.player.position;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e.node.isValid) {
                this.enemies.splice(i, 1);
                continue;
            }

            const pos = e.node.position.clone();
            const dx = pp.x - pos.x;
            const dy = pp.y - pos.y;
            const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));

            let speed = e.speed;
            if (e.species === 'red' && dist < 230) speed *= 1.22;
            e.phase += dt;
            const wobble = e.species === 'purple' ? Math.sin(e.phase * 4) * 0.22 : 0;
            const nx = dx / dist;
            const ny = dy / dist;
            pos.x += (nx - ny * wobble) * speed * dt;
            pos.y += (ny + nx * wobble) * speed * dt;
            e.node.setPosition(pos);

            e.animTimer += dt;
            const frameDuration = 1 / (e.species === 'blue' ? 8 : 6.5);
            while (e.animTimer >= frameDuration) {
                e.animTimer -= frameDuration;
                e.animIndex = (e.animIndex + 1) % e.frames.length;
            }
            e.sprite.spriteFrame = e.frames[e.animIndex];

            if (e.hitPulse > 0) {
                e.hitPulse -= dt;
                const p = 1 + Math.sin(e.hitPulse * 35) * 0.06;
                const rankScale = e.rank === 'boss' ? 1.9 : e.rank === 'elite' ? 1.45 : 1;
                e.visual.setScale(p * rankScale, (2 - p) * rankScale, 1);
            } else {
                const rankScale = e.rank === 'boss' ? 1.9 : e.rank === 'elite' ? 1.45 : 1;
                e.visual.setScale(rankScale, rankScale, 1);
            }

            if (dist <= this.playerRadius + e.radius - 5 && this.invulnerableTimer <= 0) {
                const damage = e.rank === 'boss' ? 2 : 1;
                this.damagePlayer(damage);
                const knock = e.rank === 'normal' ? 68 : 105;
                e.node.setPosition(pos.x - nx * knock, pos.y - ny * knock, 0);
                if (this.isGameOver) return;
            }
        }
    }

    private damagePlayer(amount: number) {
        this.playerHp -= amount;
        this.invulnerableTimer = 1.0;
        this.showBuffMessage(`受到 ${amount} 点伤害！`);
        if (this.playerHp <= 0) this.endGame();
    }

    private fireAtNearestEnemy() {
        if (this.enemies.length === 0) return;
        const p = this.player.position;
        let nearest: EnemyData | null = null;
        let best = Number.MAX_VALUE;
        for (const e of this.enemies) {
            if (!e.node.isValid) continue;
            const ep = e.node.position;
            const dx = ep.x - p.x;
            const dy = ep.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < best) { best = d2; nearest = e; }
        }
        if (!nearest) return;
        const ep = nearest.node.position;
        const base = Math.atan2(ep.y - p.y, ep.x - p.x);
        const spread = 0.14;
        for (let i = 0; i < this.multiShot; i++) {
            const offset = i - (this.multiShot - 1) / 2;
            this.spawnSlash(base + offset * spread);
        }
    }

    private spawnSlash(angle: number) {
        const n = new Node('SwordWave');
        this.worldLayer.addChild(n);
        n.addComponent(UITransform).setContentSize(54, 24);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(218, 245, 255, 235);
        g.moveTo(-25, -4);
        g.lineTo(17, -10);
        g.lineTo(28, 0);
        g.lineTo(17, 10);
        g.lineTo(-25, 4);
        g.close();
        g.fill();
        g.strokeColor = new Color(105, 190, 255, 255);
        g.lineWidth = 3;
        g.moveTo(-25, 0);
        g.lineTo(28, 0);
        g.stroke();
        n.setPosition(this.player.position);
        n.setRotationFromEuler(0, 0, angle * 180 / Math.PI);
        this.slashes.push({
            node: n,
            dir: new Vec3(Math.cos(angle), Math.sin(angle), 0),
            speed: this.slashSpeed,
            radius: this.slashRadius,
            life: 1.55,
            damage: this.slashDamage,
            pierceLeft: this.slashPierce,
        });
    }

    private updateSlashes(dt: number) {
        for (let i = this.slashes.length - 1; i >= 0; i--) {
            const b = this.slashes[i];
            if (!b.node.isValid) { this.slashes.splice(i, 1); continue; }
            const pos = b.node.position.clone();
            pos.x += b.dir.x * b.speed * dt;
            pos.y += b.dir.y * b.speed * dt;
            b.node.setPosition(pos);
            b.life -= dt;

            let consumed = false;
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const e = this.enemies[j];
                if (!e.node.isValid) continue;
                const ep = e.node.position;
                const dx = ep.x - pos.x;
                const dy = ep.y - pos.y;
                const hitDist = e.radius + b.radius;
                if (dx * dx + dy * dy <= hitDist * hitDist) {
                    e.hp -= b.damage;
                    e.hitPulse = 0.16;
                    if (e.hp <= 0) this.killEnemyAt(j);
                    if (b.pierceLeft > 0) b.pierceLeft -= 1;
                    else consumed = true;
                    break;
                }
            }

            if (consumed || b.life <= 0 || Math.abs(pos.x) > this.width || Math.abs(pos.y) > this.height) {
                b.node.destroy();
                this.slashes.splice(i, 1);
            }
        }
    }

    private killEnemyAt(index: number) {
        const e = this.enemies[index];
        if (!e) return;
        const pos = e.node.position.clone();
        const rank = e.rank;
        const xp = e.xp;
        if (e.node.isValid) e.node.destroy();
        this.enemies.splice(index, 1);
        this.kills += 1;
        if (rank === 'elite') this.eliteKills += 1;
        if (rank === 'boss') this.bossKills += 1;

        this.spawnXpPickup(pos, xp);
        if (rank === 'elite') this.spawnBoostPickup(pos);
        if (rank === 'boss') {
            this.spawnBoostPickup(new Vec3(pos.x - 22, pos.y, 0));
            this.spawnBoostPickup(new Vec3(pos.x + 22, pos.y, 0));
        }
    }

    private makeCircleNode(name: string, radius: number, color: Color): Node {
        const n = new Node(name);
        n.addComponent(UITransform).setContentSize(radius * 2, radius * 2);
        const g = n.addComponent(Graphics);
        g.fillColor = color;
        g.circle(0, 0, radius);
        g.fill();
        return n;
    }

    private spawnXpPickup(pos: Readonly<Vec3>, value: number) {
        const radius = value >= 8 ? 10 : value >= 3 ? 8 : 6;
        const n = this.makeCircleNode('XpOrb', radius, new Color(96, 239, 255, 255));
        this.worldLayer.addChild(n);
        n.setPosition(pos);
        this.pickups.push({ node: n, kind: 'xp', value, radius });
    }

    private spawnBoostPickup(pos: Readonly<Vec3>) {
        const kinds: BoostKind[] = ['damage', 'attackSpeed', 'multiShot', 'heal', 'blade', 'magnet'];
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const n = this.makeCircleNode('EliteBoost', 15, new Color(255, 118, 232, 255));
        this.worldLayer.addChild(n);
        n.setPosition(pos);
        const inner = this.makeCircleNode('BoostCore', 6, new Color(255, 244, 159, 255));
        n.addChild(inner);
        this.pickups.push({ node: n, kind: 'boost', boostKind: kind, value: 1, radius: 15 });
    }

    private updatePickups(dt: number) {
        const pp = this.player.position;
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const p = this.pickups[i];
            if (!p.node.isValid) { this.pickups.splice(i, 1); continue; }
            const pos = p.node.position.clone();
            const dx = pp.x - pos.x;
            const dy = pp.y - pos.y;
            const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
            if (dist <= this.pickupRadius) {
                const speed = 245 + (this.pickupRadius - Math.min(this.pickupRadius, dist)) * 4;
                pos.x += dx / dist * speed * dt;
                pos.y += dy / dist * speed * dt;
                p.node.setPosition(pos);
            }
            if (dist <= this.playerRadius + p.radius + 7) {
                if (p.kind === 'xp') this.addXp(p.value);
                else if (p.boostKind) this.applyEliteBoost(p.boostKind);
                p.node.destroy();
                this.pickups.splice(i, 1);
            }
        }
    }

    private addXp(amount: number) {
        this.xp += amount;
        this.checkPendingLevelUp();
    }

    private checkPendingLevelUp() {
        if (this.isChoosingUpgrade || this.isGameOver || this.xp < this.xpToNext) return;
        this.xp -= this.xpToNext;
        this.level += 1;
        this.xpToNext = Math.floor(8 + this.level * 4.2);
        this.openUpgradeMenu();
    }

    private openUpgradeMenu() {
        this.isChoosingUpgrade = true;
        this.currentChoices = this.rollUpgradeChoices();
        for (let i = 0; i < 3; i++) {
            const c = this.currentChoices[i];
            this.upgradeCards[i].string = `${c.title}\n\n${c.desc}`;
        }
        this.upgradeTitle.string = `LV.${this.level}  选择一个强化`;
        this.upgradeOverlay.active = true;
    }

    private rollUpgradeChoices(): UpgradeChoice[] {
        const pool: UpgradeChoice[] = [
            { kind: 'damage', title: '⚔ 强化剑气', desc: '剑气伤害 +1' },
            { kind: 'attackSpeed', title: '⚡ 疾速挥剑', desc: '攻击间隔 -12%' },
            { kind: 'multiShot', title: '✦ 多重剑气', desc: '同时释放数量 +1' },
            { kind: 'moveSpeed', title: '➤ 轻盈步伐', desc: '移动速度 +10%' },
            { kind: 'slashSpeed', title: '➶ 疾风剑气', desc: '剑气飞行速度 +15%' },
            { kind: 'pierce', title: '◆ 贯穿', desc: '剑气额外穿透 1 个敌人' },
            { kind: 'magnet', title: '◎ 经验磁铁', desc: '拾取范围 +35' },
            { kind: 'blade', title: '◈ 环绕飞刃', desc: this.bladeCount === 0 ? '解锁环绕飞刃' : '飞刃数量 +1' },
        ];
        if (this.multiShot >= 5) this.removeUpgrade(pool, 'multiShot');
        if (this.shootInterval <= 0.20) this.removeUpgrade(pool, 'attackSpeed');
        if (this.slashPierce >= 4) this.removeUpgrade(pool, 'pierce');
        if (this.bladeCount >= 5) this.removeUpgrade(pool, 'blade');

        const result: UpgradeChoice[] = [];
        while (result.length < 3 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            result.push(pool[idx]);
            pool.splice(idx, 1);
        }
        return result;
    }

    private removeUpgrade(pool: UpgradeChoice[], kind: UpgradeKind) {
        const idx = pool.findIndex(v => v.kind === kind);
        if (idx >= 0) pool.splice(idx, 1);
    }

    private applyUpgrade(kind: UpgradeKind) {
        switch (kind) {
            case 'damage': this.slashDamage += 1; break;
            case 'attackSpeed': this.shootInterval = Math.max(0.20, this.shootInterval * 0.88); break;
            case 'multiShot': this.multiShot = Math.min(5, this.multiShot + 1); break;
            case 'moveSpeed': this.playerSpeed *= 1.10; break;
            case 'slashSpeed': this.slashSpeed *= 1.15; break;
            case 'pierce': this.slashPierce = Math.min(4, this.slashPierce + 1); break;
            case 'magnet': this.pickupRadius += 35; break;
            case 'blade':
                this.bladeCount = Math.min(5, this.bladeCount + 1);
                this.refreshBlades();
                break;
        }
    }

    private applyEliteBoost(kind: BoostKind) {
        switch (kind) {
            case 'damage':
                this.slashDamage += 1;
                this.showBuffMessage('精英掉落：剑气伤害 +1');
                break;
            case 'attackSpeed':
                this.shootInterval = Math.max(0.18, this.shootInterval * 0.90);
                this.showBuffMessage('精英掉落：攻击速度 +10%');
                break;
            case 'multiShot':
                if (this.multiShot < 6) this.multiShot += 1;
                else this.slashDamage += 1;
                this.showBuffMessage('精英掉落：额外剑气 +1');
                break;
            case 'heal':
                if (this.playerHp < this.playerMaxHp) {
                    this.playerHp = Math.min(this.playerMaxHp, this.playerHp + 2);
                    this.showBuffMessage('精英掉落：恢复 2 点生命');
                } else {
                    this.playerMaxHp += 1;
                    this.playerHp = this.playerMaxHp;
                    this.showBuffMessage('精英掉落：生命上限 +1');
                }
                break;
            case 'blade':
                if (this.bladeCount < 6) {
                    this.bladeCount += 1;
                    this.refreshBlades();
                    this.showBuffMessage('精英掉落：环绕飞刃 +1');
                } else {
                    this.bladeDamage += 1;
                    this.showBuffMessage('精英掉落：飞刃伤害 +1');
                }
                break;
            case 'magnet':
                this.pickupRadius += 55;
                this.showBuffMessage('精英掉落：拾取范围大幅提升');
                break;
        }
    }

    private refreshBlades() {
        for (const b of this.bladeNodes) if (b.isValid) b.destroy();
        this.bladeNodes.length = 0;
        for (let i = 0; i < this.bladeCount; i++) {
            const n = new Node('OrbitBlade');
            n.addComponent(UITransform).setContentSize(38, 12);
            const g = n.addComponent(Graphics);
            g.fillColor = new Color(224, 245, 255, 255);
            g.roundRect(-19, -5, 32, 10, 5);
            g.fill();
            g.fillColor = new Color(245, 194, 70, 255);
            g.roundRect(12, -7, 8, 14, 3);
            g.fill();
            this.worldLayer.addChild(n);
            this.bladeNodes.push(n);
        }
    }

    private updateBlades(_dt: number) {
        if (this.bladeCount <= 0) return;
        const center = this.player.position;
        const t = this.elapsed * 2.9;
        for (let i = 0; i < this.bladeNodes.length; i++) {
            const angle = t + i * (Math.PI * 2 / this.bladeNodes.length);
            const n = this.bladeNodes[i];
            n.setPosition(center.x + Math.cos(angle) * this.bladeRadius, center.y + Math.sin(angle) * this.bladeRadius, 0);
            n.setRotationFromEuler(0, 0, angle * 180 / Math.PI + 90);
        }
        if (this.bladeHitTimer > 0) return;
        this.bladeHitTimer = 0.22;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
            const e = this.enemies[j];
            if (!e.node.isValid) continue;
            const ep = e.node.position;
            let hit = false;
            for (const blade of this.bladeNodes) {
                const bp = blade.position;
                const dx = ep.x - bp.x;
                const dy = ep.y - bp.y;
                const r = e.radius + 18;
                if (dx * dx + dy * dy <= r * r) { hit = true; break; }
            }
            if (hit) {
                e.hp -= this.bladeDamage;
                e.hitPulse = 0.16;
                if (e.hp <= 0) this.killEnemyAt(j);
            }
        }
    }

    private showBuffMessage(text: string) {
        this.buffLabel.string = text;
        this.buffLabel.node.active = true;
        this.buffMessageTimer = 2.1;
    }

    private updateUI() {
        this.scoreLabel.string = `击杀 ${this.kills}   精英 ${this.eliteKills}   Boss ${this.bossKills}`;
        const total = Math.floor(this.elapsed);
        const min = Math.floor(total / 60).toString().padStart(2, '0');
        const sec = (total % 60).toString().padStart(2, '0');
        this.timeLabel.string = `${min}:${sec}`;
        const hearts = '♥'.repeat(Math.max(0, this.playerHp));
        this.hpLabel.string = `生命 ${hearts || '0'}`;
        this.levelLabel.string = `LV.${this.level}   EXP ${this.xp}/${this.xpToNext}`;
    }

    private endGame() {
        this.isGameOver = true;
        this.isChoosingUpgrade = false;
        this.upgradeOverlay.active = false;
        this.gameOverOverlay.active = true;
        this.gameOverLabel.string = `挑战结束\n\n生存 ${Math.floor(this.elapsed)} 秒\n击杀 ${this.kills} · 精英 ${this.eliteKills} · Boss ${this.bossKills}\n最高等级 LV.${this.level}\n\n点击屏幕重新开始`;
        this.helpLabel.node.active = false;
    }

    private restartGame() {
        for (const e of this.enemies) if (e.node.isValid) e.node.destroy();
        for (const b of this.slashes) if (b.node.isValid) b.node.destroy();
        for (const p of this.pickups) if (p.node.isValid) p.node.destroy();
        for (const b of this.bladeNodes) if (b.isValid) b.destroy();
        this.enemies.length = 0;
        this.slashes.length = 0;
        this.pickups.length = 0;
        this.bladeNodes.length = 0;

        this.playerSpeed = 330;
        this.playerHp = 4;
        this.playerMaxHp = 4;
        this.invulnerableTimer = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 0.66;
        this.eliteTimer = 20;
        this.bossTimer = 72;
        this.shootTimer = 0;
        this.shootInterval = 0.58;
        this.slashDamage = 1;
        this.slashSpeed = 620;
        this.slashPierce = 0;
        this.multiShot = 1;
        this.pickupRadius = 105;
        this.bladeCount = 0;
        this.bladeDamage = 1;
        this.bladeHitTimer = 0;
        this.elapsed = 0;
        this.kills = 0;
        this.eliteKills = 0;
        this.bossKills = 0;
        this.level = 1;
        this.xp = 0;
        this.xpToNext = 8;
        this.isGameOver = false;
        this.isChoosingUpgrade = false;
        this.buffMessageTimer = 0;
        this.pressedKeys.clear();

        this.player.setPosition(0, -40, 0);
        this.playerTarget.set(this.player.position);
        this.playerAnimState = 'idle';
        this.playerAnimIndex = 0;
        this.playerAnimTimer = 0;
        this.playerFacing = 1;
        this.playerVisual.active = true;
        this.gameOverOverlay.active = false;
        this.helpLabel.node.active = true;
        this.buffLabel.node.active = false;
        this.refreshBlades();
        this.updateUI();
    }
}

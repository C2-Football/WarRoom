// ══════════════════════════════════════════════════════════════════
// js/components/time-league-helmet.js — window.TimeLeagueHelmetIcon,
// window.TimeLeagueHelmetPicker
// Detailed retro helmet artwork plus a full-screen identity workshop.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const h = React.createElement;
    const Helmet = window.App.TimeLeagueHelmet;

    const PIXEL_FONT = {
        A: '01110/10001/10001/11111/10001/10001/10001', B: '11110/10001/10001/11110/10001/10001/11110',
        C: '01111/10000/10000/10000/10000/10000/01111', D: '11110/10001/10001/10001/10001/10001/11110',
        E: '11111/10000/10000/11110/10000/10000/11111', F: '11111/10000/10000/11110/10000/10000/10000',
        G: '01111/10000/10000/10111/10001/10001/01111', H: '10001/10001/10001/11111/10001/10001/10001',
        I: '11111/00100/00100/00100/00100/00100/11111', J: '00111/00010/00010/00010/10010/10010/01100',
        K: '10001/10010/10100/11000/10100/10010/10001', L: '10000/10000/10000/10000/10000/10000/11111',
        M: '10001/11011/10101/10101/10001/10001/10001', N: '10001/11001/10101/10011/10001/10001/10001',
        O: '01110/10001/10001/10001/10001/10001/01110', P: '11110/10001/10001/11110/10000/10000/10000',
        Q: '01110/10001/10001/10001/10101/10010/01101', R: '11110/10001/10001/11110/10100/10010/10001',
        S: '01111/10000/10000/01110/00001/00001/11110', T: '11111/00100/00100/00100/00100/00100/00100',
        U: '10001/10001/10001/10001/10001/10001/01110', V: '10001/10001/10001/10001/10001/01010/00100',
        W: '10001/10001/10001/10101/10101/10101/01010', X: '10001/10001/01010/00100/01010/10001/10001',
        Y: '10001/10001/01010/00100/00100/00100/00100', Z: '11111/00001/00010/00100/01000/10000/11111',
        '?': '01110/10001/00001/00010/00100/00000/00100',
    };

    // CC0 source geometry: https://commons.wikimedia.org/wiki/File:FootballHelmet.svg
    // Keep these native 1000 × 1000 paths intact. The old component tried to
    // approximate this cage from disconnected bars, which made the helmet feel
    // cartoonish and broke the silhouette the reference gets right.
    const SOURCE_PATHS = {
        backPost: 'm935.43 819.53c7.9329 1.9832 18.51-12.56 19.832-31.071 1.3222-18.51 3.9665-64.125 3.9665-101.14 0-37.02-5.2886-78.668-9.2551-94.534s-21.511-33.555-27.104-19.171c-4.6276 11.899 0.92496 13.883 4.8914 31.071 3.9665 17.188 11.636 57.514 11.636 102.47 0 44.953-1.9832 65.447-1.9832 76.685s-7.9329 9.2551-9.9162 11.899c-1.9832 2.6443-5.2886 7.2719-4.6276 13.222 0.66108 5.9497 12.56 10.577 12.56 10.577z',
        upperMask: 'm709.89 374.66c6.5596 16.763 37.9 101.31 44.459 124.63 6.5596 23.323 6.758 23.277 10.204 30.611 1.6415 3.494 4.8726 4.7948 11.661 5.1019 10.946 0.49515 44.459 0 72.155 2.9154s48.241 8.3402 62.227 17.146c13.985 8.8055 24.863 22.273 27.453 29.006 2.5899 6.7336-3.6258 9.8415-9.8415 8.2876s-10.877-6.2157-17.093-12.431c-6.2157-6.2157-26.935-16.575-55.423-20.201-28.488-3.6258-75.106-6.7336-77.178-6.7336-2.0719 0-3.6258-0.51797-3.1078 4.6618 0.51797 5.1797 3.6258 16.575 5.1797 19.683 1.5539 3.1078 1.5539 4.1438 10.359 4.1438 8.8055 0 56.977 4.1438 71.48 5.1797s33.668 6.7336 45.582 10.877c11.913 4.1438 26.417 12.949 32.632 18.647 6.2157 5.6977 9.8415 13.467 9.8415 19.683 0 6.2157-1.5539 13.467-5.6977 19.165-4.1438 5.6977-9.3235 6.2157-13.467 3.1078-4.1438-3.1078-12.949-2.5899-7.7696-12.949 5.1797-10.359-0.51797-19.683-17.093-25.381-16.575-5.6977-51.279-16.057-80.286-18.129-29.006-2.0719-32.632-1.036-32.632-1.036s-5.3116 0.0345-3.6258 6.2157c4.6618 17.093 11.395 42.992 13.985 51.279 2.5899 8.2876 13.445 29.413 25.899 41.438 15.021 14.503 51.797 36.776 68.89 51.279s27.97 32.632 33.15 43.51c5.1797 10.877 6.2157 11.913 7.2516 18.129 1.0359 6.2157-1.5539 15.021-5.1797 14.503-3.6258-0.51797-8.8055 6.7336-15.021-12.949-6.2157-19.683-14.503-35.222-39.366-54.387s-37.294-30.56-52.833-41.438c-11.79-8.2532-23.309-18.647-30.042-31.596-6.7336-12.949-16.055-40.133-21.237-62.157-4.1438-17.611-6.7336-22.791-13.985-23.309-10.346-0.73901-44.028 1.036-58.013 0.51798-13.985-0.51798-27.971-0.51798-42.992-1.5539-15.021-1.036-25.381-18.647-3.1078-19.683 22.273-1.0359 98.415 0.51798 101.52 0 3.1078-0.51797 3.6258-1.5539 2.0719-5.1797s-5.6977-19.165-6.7336-21.755c-1.036-2.5899-7.7696-0.51798-14.503-1.5539-6.7336-1.0359-19.165-7.7696-33.15-45.582s-33.15-27.97-33.15-27.97-2.5899 4.6618-17.611 5.1797c-15.021 0.51798-18.647-8.8055-10.359-12.431 8.2876-3.6258 24.863-10.359 36.776-11.913 11.913-1.5539 24.345 4.1438 29.006 14.503 4.6618 10.359 18.647 40.92 22.791 47.653 4.1438 6.7336 3.2856 5.572 6.2157 7.7696 6.2157 4.6618 7.2516 0 1.5539-12.949s-18.129-56.459-23.827-67.854c-5.6977-11.395-21.237-56.459-26.417-69.408-5.1797-12.949 6.7336-22.791 11.913-14.503 5.1797 8.2876 6.4828 10.208 6.4828 10.208z',
        innerPanel: 'm578.56 382.5c-16.029 0.0226-32.59 0.75045-49.062 2.5312-87.853 9.4976-257.64 86.679-324.12 175.72-66.483 89.04-5.9375 169.75-5.9375 169.75s19.005 34.433 38 15.438 86.663-55.784 113.97-67.656c27.306-11.872 72.419-24.929 123.47 8.3125 51.05 33.242 99.729 39.156 138.91 39.156 39.178 0 83.096-33.229 93.781-73.594s-9.5012-74.794-14.25-125.84c-4.7488-51.05 7.1268-98.539 14.25-130.59 0 0-59.541-13.317-129-13.219zm-47.125 113.75c12.564 0.0579 25.877 5.095 36.156 14.75 18.274 17.164 20.015 42.447 3.875 56.469-16.14 14.021-44.038 11.477-62.312-5.6875s-20.015-42.447-3.875-56.469c7.0611-6.1344 16.384-9.1076 26.156-9.0625z',
        shell: 'm385.84 95.344c-143.99 0.267-274.14 115-314.62 198.28-45.738 94.09-46.275 187.56-15.408 284.91 30.868 97.35 64.098 135.36 78.348 175.72 14.246 40.365 28.502 32.062 38 32.062 9.4976 0 29.667-9.4937 72.406 15.438 64.025 37.348 127.04 60.531 173.34 60.531 46.301 0 85.479-8.2941 127.03-59.344 41.552-51.05 4.7455-111.6-13.062-153.16-17.808-41.552-14.246-74.79 3.5625-110.41 17.808-35.616 66.965-60.8 102.09-71.25 42.032-12.503 70.736-27.487 104.83-42.74 34.499-15.432 35.258-34.421 28.135-49.854-7.12-15.43-36.81-65.28-46.31-83.09s-72.41-197.59-338.35-197.1zm-72.375 546c12.564 0.0579 25.877 5.095 36.156 14.75 18.274 17.164 20.015 42.447 3.875 56.469-16.14 14.021-44.038 11.446-62.312-5.7188-18.274-17.164-20.015-42.447-3.875-56.469 7.0611-6.1344 16.384-9.0763 26.156-9.0312z',
        stripe: 'm382.19 104.72c-72.444 0-139.15 27.612-188.56 55.938-12.58 8.6493-24.52 17.848-35.719 27.375 50.47-33.233 117.21-61.062 196.81-61.062 154.45 0 248.73 96.607 304.97 195.03 42.57 74.49 44.69 108.02 40.31 122.69 12.95-5.75 25.54-11.7 38.81-17.69 8.21-20.01 4.11-67.84-77.81-180.91-35.17-48.55-129.96-141.37-278.81-141.37z',
        hinge: 'm644.52 328.14c27.921-11.862 50.3-19.686 64.264-25.004 15.677-5.9706 24.766-17.087 33.503 1.5269 11.307 24.089 24.897 51.377 32.463 63.466 6.8451 10.937 5.6212 27.593 0.9797 35.901-6.9832 12.499-20.422 20.123-28.417 23.55-7.9949 3.4264-48.282 23.008-69.217 30.514-12.128 4.3484 7.8567-8.9365 0.47722-21.183-5.6789-9.4241-21.435-20.902-29.048-37.749-23.747-52.546-26.022-61.578-5.0045-71.022z',
        cage: 'm771.53 369.88c-16.945 11.202-68.442 36.627-97.69 50.496-28.62 13.566-122.78 59.383-147.91 71.375-25.127 11.992-40.542 17.136-50.25 26.844-9.7081 9.7081-43.954 45.669-55.375 59.375s-13.716 17.147-16 24c-2.2842 6.8528-7.437 16.55-13.719 31.969-6.2817 15.419-29.119 71.959-33.688 85.094-4.5685 13.134-5.6935 14.849-1.125 22.844 4.5685 7.9949 6.2637 3.4345 13.688 5.7188 7.4238 2.2842 40.561 18.852 59.406 24.562 18.845 5.7106 33.13 6.2842 82.812 4 27.84-1.28 52.278-3.492 76.719-6.0625 2.3598 5.9369 9.0873 22.917 15.5 40.406 7.6355 20.824 24.979 61.088 63.156 71.5s84.695 13.188 116.62 13.188c31.93 0 90.211-7.6344 104.09-13.188 13.883-5.5531 42.264-13.38 50-43.031 4.0559-15.547 1.8845-25.298-2.0795-35.17-3.3722-8.3987-21.002-0.19323-17.214 9.7372 5.8519 15.342-0.16516 28.89-17.518 39.996s-72.868 20.844-119.38 20.844c-46.507 0-81.211-3.4735-95.094-6.25s-39.573-14.593-54.844-50.688c-10.68-25.243-17.383-41.784-20.594-49.781 11.816-1.3192 23.861-2.6886 36.531-4.0625 47.398-5.1396 105.65-18.871 158.19-33.719 52.538-14.848 106.78-43.962 119.34-54.812 12.563-10.85 26.989-22.319 24.562-38.844-0.95491-6.5019-4.3568-7.9945-9-7.1562-4.0429 0.72989-6.9038 5.6865-17.125 16.406-22.554 23.654-42.838 30.789-63.156 39.594-10.722 4.6461-49.937 19.89-112.44 34.5-62.5 14.61-130.67 23.125-140.41 23.125-9.7403 0-8.9893-4.7179-11.188-9.9375-2.7553-6.5424-2.7915-7.9788-3.4375-11.156-0.97699-4.8055-0.55127-6.5004 6.0938-6.9062 11.755-0.71792 86.425-10.379 110.22-14.875 45.738-8.6417 86.735-21.255 103.38-26.531 37.069-12.382 65.587-24.84 96.75-44.594 10.695-7.1267 21.536-16.257 28-26.344 6.9851-10.901-0.26696-25.244-12.812-36.344-12.097-10.703-21.719-4.5771-21.719 0.5625s2.3035 8.5792 9.1562 13.719c6.8528 5.1396 5.6935 11.982 1.125 19.406-4.5685 7.4238-11.389 11.435-30.969 22.312-19.579 10.877-63.63 26.666-95.719 37-32.088 10.334-63.076 16.305-88.094 20.656s-94.642 11.975-103.34 13.062c-8.7019 1.0877-15.762 4.3323-17.938-0.5625-2.1755-4.8948-2.1989-8.134-7.0938-23.906-4.8948-15.772-53.97-128.61-57.062-135.56-3.0922-6.9573-2.3109-7.7039 0.78125-9.25s8.5632-4.3441 31.344-14.469c22.78-10.125 72.297-38.551 123.19-61.594 33.793-15.301 100.86-46.801 120.24-64.494 7.4992-6.847 0.084-24.249-16.928-13.003zm-280.59 168.62c1.3946 0.0257 2.4327 0.85564 2.8438 2.5 0.93964 3.7585 23.474 53.065 34.75 79.375s23.966 61.084 25.375 65.312c1.4094 4.2284 4.7313 9.1822-2.8125 9.875-4.385 0.4027-11.748 7.5146-26.312-12.688-14.564-20.202-23.016-32.889-29.594-40.406-6.5774-7.517-12.217-15.516-26.781-22.094-14.564-6.5774-31.491-14.091-35.25-15.5-3.7585-1.4094-8.4535-3.7361-1.4062-9.8438 7.0472-6.1076 24.919-26.325 32.906-34.781 7.9869-8.4567 19.719-17.844 19.719-17.844 2.3784-2.6427 4.7694-3.9393 6.5625-3.9062zm-70.19 86.53c0.50641 0.0328 1.0408 0.1908 1.625 0.46875 7.2276 3.4391 34.474 16.544 39.844 18.781 5.3693 2.2372 11.169 9.8295 23.25 25.938s27.744 38.483 32.219 42.062c4.4744 3.5796 13.864 8.9574 22.812 8.0625 8.9489-0.89488 27.305-4.9176 30.438 4.0312 3.1321 8.9489 6.7188 19.241 6.7188 21.031 0 1.7898 2.2216 5.3651-4.9375 5.8125-7.1591 0.44745-64.862 3.1364-82.312 4.0312-17.45 0.89489-32.234 3.125-56.844-6.7188-24.609-9.8438-42.932-16.116-47.406-17.906-4.4744-1.7898-11.202-1.3281-4.9375-16.094 6.2642-14.766 24.17-59.499 27.75-68 3.5796-8.5014 3.6762-8.8212 5.125-12.75 1.3723-3.7214 3.1114-8.9799 6.6562-8.75z',
        frontPost: 'm854.17 640.37c-1.7898 5.8168-1.7898 11.517 0.44745 12.859 2.2372 1.3423 11.047 0.0289 25.504 49.219 3.591 12.218 10.291 70.696 10.291 86.804s0.44744 80.092-0.89489 83.672c-1.3423 3.5796-3.1321 8.9489 2.6847 8.5014 5.8168-0.44745 11.634-1.3423 15.661-6.7117 4.027-5.3693 1.7898-49.666 1.7898-87.699s-6.2642-79.198-14.318-101.57c-8.054-22.372-14.766-42.06-22.372-47.876-7.6066-5.8168-17.432-1.6198-18.793 2.8016z',
        hingeTop: 'm702.53 431.29s11.778-3.8043 7.1401-14.627c-2.9406-6.8613-6.1843-9.663-11.982-8.8899-4.5975 0.613-4.2517-1.5461-8.1169-7.7304s-8.5034-12.369-1.9326-16.62c8.2925-5.3657 16.234-8.1169 19.712-10.049 3.4787-1.9326 4.6382 2.7056 7.7304 7.3439 3.7169 5.1879 4.6445 11.08 10.436 9.663 6.3251-1.5473 11.641 1.6372 14.688 9.2764 2.2411 5.6196 4.3736 11.656-5.2894 17.068-7.2956 4.0855-18.532 10.375-23.943 13.467-5.4113 3.0922-8.4425 1.0986-8.4425 1.0986z',
        hingeFront: 'm748.81 407.44s11.413-3.6889 6.9189-14.183c-2.8495-6.6532-5.9927-9.3698-11.611-8.6202-4.4551 0.59441-4.12-1.4992-7.8654-7.4959s-8.24-11.993-1.8727-16.116c8.0356-5.2029 14.388-5.6334 17.759-7.5074 3.3709-1.874 4.4945 2.6236 7.4909 7.1211 3.6017 5.0305 2.2634 10.744 7.8754 9.3698 6.1292-1.5004 10.386 2.0349 13.338 9.4425 2.1717 5.4491 2.4483 9.5131-5.573 14.76-6.7818 4.4363-13.036 9.1655-18.279 12.164-5.2436 2.9984-8.1809 1.0653-8.1809 1.0653z',
        lowerHardware: 'm382.9 652.81s-1.8793-1.4094-6.5774 1.8793c-4.6982 3.2887-13.155 32.887-15.974 38.525-2.8189 5.6378-4.6982 12.685-1.8793 16.444 2.8189 3.7585 11.745 9.3963 17.853 8.4567 6.1076-0.93963 7.9869-7.0472 12.685-6.1076 4.6982 0.93964 17.383 7.5171 24.43 10.336 7.0472 2.8189 36.646 10.806 48.391-7.0472s-1.8793-32.887-17.853-39.465c-15.974-6.5774-33.827-12.215-37.115-13.625-3.2887-1.4094-5.168 2.3491-9.8661 2.8189-4.6982 0.46982-8.4567-0.46981-12.215-4.2283-3.7585-3.7585-1.8793-7.9869-1.8793-7.9869z',
        rivet: 'm451.24 705.15a19.485 15.896 0 1 1 -38.971 0 19.485 15.896 0 1 1 38.971 0z',
    };

    function rgb(hex) {
        const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
        const value = match ? match[1] : '000000';
        return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
    }

    function mixColor(hex, target, amount) {
        const source = rgb(hex);
        const destination = rgb(target);
        return `rgb(${source.map((channel, index) => Math.round((channel + ((destination[index] - channel) * amount)) * 255)).join(' ')})`;
    }

    function lighten(hex, amount) { return mixColor(hex, '#ffffff', amount); }
    function darken(hex, amount) { return mixColor(hex, '#000000', amount); }

    function PixelMonogram({ mark, color }) {
        const characters = String(mark || '?').toUpperCase().slice(0, 2).split('');
        const scale = 2.25;
        const glyphWidth = 5 * scale;
        const totalWidth = (characters.length * glyphWidth) + ((characters.length - 1) * scale);
        const startX = 44 - (totalWidth / 2);
        const pixels = [];
        characters.forEach((character, characterIndex) => {
            const rows = (PIXEL_FONT[character] || PIXEL_FONT['?']).split('/');
            rows.forEach((row, y) => row.split('').forEach((on, x) => {
                if (on !== '1') return;
                pixels.push(h('rect', {
                    key: `${characterIndex}:${x}:${y}`, x: startX + (characterIndex * (glyphWidth + scale)) + (x * scale),
                    y: 25 + (y * scale), width: scale, height: scale, fill: color,
                }));
            }));
        });
        return h('g', { shapeRendering: 'crispEdges' }, pixels);
    }

    function DecalArt({ decal, mark, color, shell }) {
        if (decal === 'blank') return null;
        if (decal === 'monogram') return h(PixelMonogram, { mark, color });
        if (decal === 'horseshoe') return h('g', { fill: color },
            h('path', { d: 'M27 22H37V28H34V39C34 47 38 51 44 51S54 47 54 39V28H51V22H61V28H60V39C60 51 54 58 44 58S28 51 28 39V28H27Z' }),
            [[31,31],[31,40],[35,49],[44,54],[53,49],[57,40],[57,31]].map(([x,y]) => h('circle', { key: `${x}-${y}`, cx: x, cy: y, r: 1.15, fill: shell })));
        if (decal === 'star') return h('path', { d: 'M45 24h6v10h10v6h-7v6h4v10l-10-6-11 6 4-10-8-6h10Z', fill: color, shapeRendering: 'crispEdges' });
        if (decal === 'bolt') return h('path', { d: 'M50 23h11L51 39h8L39 62l5-17H34Z', fill: color, shapeRendering: 'crispEdges' });
        if (decal === 'wing') return h('g', { fill: color, shapeRendering: 'crispEdges' },
            h('path', { d: 'M27 48h6v-6h7v-5h8v-4h17v5H53v4h-7v5h-6v7h-6v6h-7Z' }),
            h('rect', { x: 39, y: 56, width: 22, height: 4 }), h('rect', { x: 46, y: 49, width: 18, height: 4 }));
        return h('g', { shapeRendering: 'crispEdges' },
            h('path', { d: 'M32 27h30v23h-4v7h-5v5h-6v4h-6v-4h-6v-5h-5v-7h-4V27Z', fill: color }),
            h('path', { d: 'M35 34h18v15h-3v6h-6v4h-6v-4h-3Z', fill: '#0b0b0d', opacity: .58 }));
    }

    function TimeLeagueHelmetIcon({ helmet, letter, size = 32, title }) {
        const spec = Helmet.normalizeHelmet(helmet, letter || 'fallback');
        const shell = Helmet.colorById(spec.color).hex;
        const uid = React.useId().replace(/:/g, '');
        const tileClipId = `tl-helmet-tile-${uid}`;
        const shellGradientId = `tl-helmet-shell-${uid}`;
        const upperMaskGradientId = `tl-helmet-upper-mask-${uid}`;
        const cageGradientId = `tl-helmet-cage-${uid}`;
        const chromeGradientId = `tl-helmet-chrome-${uid}`;
        const showCage = spec.facemask !== 'none';
        return h('svg', {
            className: 'tl-helmet', viewBox: '0 0 1000 1000', width: size, height: size,
            'aria-hidden': title ? undefined : 'true', role: title ? 'img' : undefined,
        },
        title && h('title', null, title),
        h('defs', null,
            h('clipPath', { id: tileClipId }, h('rect', { x: 10, y: 10, width: 980, height: 980, rx: 94 })),
            h('radialGradient', {
                id: shellGradientId, gradientUnits: 'userSpaceOnUse', cy: 361.22, cx: 444.77,
                gradientTransform: 'matrix(-1.3068 -1.0068e-7 8.8353e-8 -1.1468 1040.3 728.58)', r: 369.8,
            }, h('stop', { offset: '0', stopColor: lighten(shell, .18) }), h('stop', { offset: '1', stopColor: darken(shell, .16) })),
            h('linearGradient', {
                id: upperMaskGradientId, gradientUnits: 'userSpaceOnUse', y2: 594.64, x2: 950.48, y1: 594.64, x1: 641.05,
            }, h('stop', { offset: '0', stopColor: darken(spec.facemaskColor, .24) }), h('stop', { offset: '1', stopColor: darken(spec.facemaskColor, .19) })),
            h('linearGradient', {
                id: cageGradientId, gradientUnits: 'userSpaceOnUse', y2: 624.01, x2: 839.5, y1: 730.92, x1: 555,
            }, h('stop', { offset: '0', stopColor: darken(spec.facemaskColor, .18) }), h('stop', { offset: '1', stopColor: lighten(spec.facemaskColor, .08) })),
            h('linearGradient', {
                id: chromeGradientId, gradientUnits: 'userSpaceOnUse', y2: 432.93, x2: 743.4, y1: 343.93, x1: 701.61,
            }, h('stop', { offset: '0', stopColor: '#FFFFFF' }), h('stop', { offset: '.76142', stopColor: '#C5C5C5' }), h('stop', { offset: '1', stopColor: '#5D5D5D' }))),
        h('rect', { x: 10, y: 10, width: 980, height: 980, rx: 94, fill: '#050506' }),
        h('g', { clipPath: `url(#${tileClipId})` },
            h('g', null,
            showCage && h('path', { d: SOURCE_PATHS.backPost, fill: darken(spec.facemaskColor, .2) }),
            showCage && h('path', { d: SOURCE_PATHS.upperMask, fill: `url(#${upperMaskGradientId})` }),
            h('path', { d: SOURCE_PATHS.innerPanel, fill: '#08090B', stroke: '#08090B', strokeWidth: 1 }),
            h('path', { d: SOURCE_PATHS.shell, fill: `url(#${shellGradientId})`, stroke: darken(shell, .32), strokeWidth: 1 }),
            spec.stripeStyle !== 'none' && h('path', { d: SOURCE_PATHS.stripe, fill: spec.stripeColor }),
            h('g', { transform: 'translate(-35 -50) scale(10)' }, h(DecalArt, { decal: spec.decal, mark: letter || '?', color: spec.accentColor, shell })),
            showCage && h(React.Fragment, null,
                h('path', { d: SOURCE_PATHS.hinge, fill: `url(#${chromeGradientId})`, stroke: '#CECECE', strokeWidth: 1 }),
                h('path', { d: SOURCE_PATHS.cage, fill: `url(#${cageGradientId})` }),
                h('path', { d: SOURCE_PATHS.frontPost, fill: lighten(spec.facemaskColor, .04) }),
                h('path', { d: SOURCE_PATHS.hingeTop, fill: '#898989', fillOpacity: .52941, stroke: '#CECECE', strokeWidth: 2.2 }),
                h('path', { d: SOURCE_PATHS.hingeFront, fill: '#898989', fillOpacity: .52941, stroke: '#CECECE', strokeWidth: 2.2 }),
                h('path', { d: SOURCE_PATHS.lowerHardware, fill: '#4C4C4C', fillOpacity: .53107, stroke: '#CECECE', strokeWidth: 2.2 }),
                h('path', { d: SOURCE_PATHS.rivet, transform: 'matrix(.95586 .29383 -.29383 .95586 222.15 -99.838)', fill: '#BDBDBD' })))),
        h('rect', { x: 17.5, y: 17.5, width: 965, height: 965, rx: 86, fill: 'none', stroke: spec.accentColor, strokeWidth: 15 }));
    }

    function Section({ title, hint, children }) {
        return h('section', { className: 'tl-helmet-control' },
            h('div', { className: 'tl-helmet-control-head' }, h('strong', null, title), hint && h('span', null, hint)),
            children);
    }

    function ChoiceButton({ selected, label, sublabel, mark, onClick }) {
        return h('button', { type: 'button', 'aria-pressed': selected, className: `tl-helmet-choice${selected ? ' selected' : ''}`, onClick },
            mark && h('b', null, mark), h('span', null, label), sublabel && h('small', null, sublabel));
    }

    function TimeLeagueHelmetPicker({ helmet, letter, name, onChange }) {
        const [open, setOpen] = React.useState(false);
        const dialogRef = React.useRef(null);
        const surpriseCount = React.useRef(0);
        const teamName = name || letter || 'Your team';
        const mark = letter || Helmet.monogramFor(teamName);
        const spec = Helmet.normalizeHelmet(helmet, teamName);
        const set = (patch) => onChange(Helmet.normalizeHelmet({ ...spec, ...patch }, teamName));

        React.useEffect(() => {
            if (!open) return undefined;
            const previousFocus = document.activeElement;
            const previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            dialogRef.current?.querySelector('button')?.focus();
            const closeOnEscape = (event) => {
                if (event.key === 'Escape') setOpen(false);
                if (event.key !== 'Tab') return;
                const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            };
            document.addEventListener('keydown', closeOnEscape);
            return () => {
                document.removeEventListener('keydown', closeOnEscape);
                document.body.style.overflow = previousOverflow;
                previousFocus?.focus();
            };
        }, [open]);

        const surprise = () => {
            surpriseCount.current += 1;
            onChange(Helmet.defaultHelmet(`${teamName}:surprise:${Date.now()}:${surpriseCount.current}`));
        };

        const editor = open && h('div', { className: 'tl-helmet-workshop-backdrop', onMouseDown: () => setOpen(false) },
            h('div', { ref: dialogRef, className: 'tl-helmet-workshop', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Customize ${teamName} helmet`, onMouseDown: (event) => event.stopPropagation() },
                h('header', { className: 'tl-helmet-workshop-head' },
                    h('div', null, h('span', { className: 'tl-eyebrow' }, 'TEAM IDENTITY'), h('h2', null, 'Retro Helmet Workshop')),
                    h('button', { type: 'button', className: 'tl-helmet-close', 'aria-label': 'Close helmet workshop', onClick: () => setOpen(false) }, '×')),
                h('div', { className: 'tl-helmet-workshop-body' },
                    h('div', { className: 'tl-helmet-big-preview' },
                        h('div', { className: 'tl-helmet-preview-copy' }, h('span', null, 'YOUR SUNDAY IDENTITY'), h('strong', null, teamName), h('small', null, spec.facemask === 'none' ? 'Classic shell · No mask' : 'Classic shell · Full cage')),
                        h(TimeLeagueHelmetIcon, { helmet: spec, letter: mark, size: 210, title: `${teamName} helmet preview` })),
                    h(Section, { title: 'Start with a classic', hint: 'Curated throwbacks' },
                        h('div', { className: 'tl-helmet-preset-grid' }, Helmet.HELMET_PRESETS.map((preset) => h('button', {
                            key: preset.id, type: 'button', className: 'tl-helmet-preset', onClick: () => onChange(Helmet.presetHelmet(preset.id)),
                        }, h(TimeLeagueHelmetIcon, { helmet: preset.spec, letter: mark, size: 72 }), h('span', null, h('b', null, preset.label), h('small', null, preset.era)))))),
                    h('div', { className: 'tl-helmet-controls-grid' },
                        h(Section, { title: 'Helmet decal' }, h('div', { className: 'tl-helmet-choice-grid three' }, Helmet.DECAL_STYLES.map((decal) => h(ChoiceButton, {
                            key: decal.id, selected: spec.decal === decal.id, label: decal.label, mark: decal.id === 'monogram' ? mark : decal.mark, onClick: () => set({ decal: decal.id }),
                        }))))),
                    h(Section, { title: 'Shell color', hint: Helmet.colorById(spec.color).label },
                        h('div', { className: 'tl-helmet-color-row' }, Helmet.HELMET_COLORS.map((color) => h('button', {
                            key: color.id, type: 'button', title: color.label, 'aria-label': color.label,
                            className: `tl-helmet-color${spec.color === color.id ? ' selected' : ''}`,
                            style: { '--swatch': color.hex }, onClick: () => set({ color: color.id }),
                        })))),
                    h(Section, { title: 'Decal & stripe color' },
                        h('div', { className: 'tl-helmet-color-row' }, Helmet.ACCENT_COLORS.map((color) => h('button', {
                            key: color.id, type: 'button', title: color.label, 'aria-label': color.label,
                            className: `tl-helmet-color${spec.accentColor === color.hex ? ' selected' : ''}`,
                            style: { '--swatch': color.hex }, onClick: () => set({ accentColor: color.hex, stripeColor: color.hex }),
                        })))),
                    h('div', { className: 'tl-helmet-controls-grid' },
                        h(Section, { title: 'Center stripe' }, h('div', { className: 'tl-helmet-choice-grid two' }, Helmet.STRIPE_STYLES.filter((stripe) => ['none', 'single'].includes(stripe.id)).map((stripe) => h(ChoiceButton, {
                            key: stripe.id, selected: stripe.id === 'none' ? spec.stripeStyle === 'none' : spec.stripeStyle !== 'none', label: stripe.label, onClick: () => set({ stripeStyle: stripe.id, stripe: stripe.id !== 'none' }),
                        })))),
                        h(Section, { title: 'Facemask' }, h('div', { className: 'tl-helmet-choice-grid two' }, Helmet.FACEMASK_STYLES.filter((facemask) => ['cage', 'none'].includes(facemask.id)).map((facemask) => h(ChoiceButton, {
                            key: facemask.id, selected: facemask.id === 'none' ? spec.facemask === 'none' : spec.facemask !== 'none', label: facemask.label, onClick: () => set({ facemask: facemask.id }),
                        }))))),
                    h(Section, { title: 'Facemask finish' },
                        h('div', { className: 'tl-helmet-color-row' }, Helmet.FACEMASK_COLORS.map((color) => h('button', {
                            key: color, type: 'button', title: 'Facemask color', 'aria-label': 'Facemask color',
                            className: `tl-helmet-color${spec.facemaskColor === color ? ' selected' : ''}`,
                            style: { '--swatch': color }, onClick: () => set({ facemaskColor: color }),
                        }))))),
                h('footer', { className: 'tl-helmet-workshop-actions' },
                    h('button', { type: 'button', className: 'tl-btn', onClick: surprise }, '↻ SURPRISE ME'),
                    h('button', { type: 'button', className: 'tl-btn primary', onClick: () => setOpen(false) }, 'USE THIS HELMET →'))));

        return h(React.Fragment, null,
            h('span', { className: 'tl-helmet-picker' },
                h('button', {
                    type: 'button', className: 'tl-helmet-trigger', title: 'Build a retro helmet',
                    'aria-label': `Customize ${teamName} helmet`, onClick: () => setOpen(true),
                }, h(TimeLeagueHelmetIcon, { helmet: spec, letter: mark, size: 45 }))),
            editor && window.ReactDOM?.createPortal ? window.ReactDOM.createPortal(editor, document.body) : editor);
    }

    window.TimeLeagueHelmetIcon = TimeLeagueHelmetIcon;
    window.TimeLeagueHelmetPicker = TimeLeagueHelmetPicker;
})();

let video = document.querySelector(".video");
const canvas = document.getElementById("canv");
const ctx = canvas.getContext("2d");
let slider = document.getElementById('slider');

let video_size = {'w': 0, 'h': 0};
let filename = 'in.mp4';
let time_start = 0;
let time_end = 1;
let crop = [null, null];
let selected_file = null;

$(() => {
	console.log('Loaded DOM.');

	$("#video_selector").change(function (e) {
		let fileInput = e.target;
		let fileUrl = window.URL.createObjectURL(fileInput.files[0]);
		filename = fileInput.files[0].name;
		selected_file = fileInput.files[0];
		$(".video").attr("src", fileUrl);
		e.target.remove();
	});

	$("#mute_toggle").click(function (){
		$(video).prop('muted', !$(video).prop('muted'));
	});

	$(".video").bind("loadedmetadata", function (e) {
		video_size = {'w': this.videoWidth, 'h': this.videoHeight};
		size_stage_to_video();
		fit_video_display();
		if (window.ResizeObserver) {
			new ResizeObserver(fit_video_display).observe(document.getElementById('resizable'));
		}
		$('.hide_until_load').removeClass('hidden');
		noUiSlider.create(slider, {
			start: [0, this.duration],
			connect: true,
			range: {
				'min': 0,
				'max': this.duration
			}
		});
		slider.noUiSlider.on('update', (range)=>{
			update_slider_fields(range);
		});
		update_slider_fields();
	}).bind('loadeddata', function(e) {
		// noinspection JSIgnoredPromiseFromCall
		e.target.play();  // start playing
	}).on('pause', (e)=>{
		console.log('Paused: ', e.target.currentTime)
	});

	$('.slider_control').on('change', (e)=>{
		set_slider();
	});

	let drawing = false;
	$("#canv").mousedown((e)=>{
		let pos = get_stage_pos(e);
		drawing = true;
		console.log('click', pos);
		crop = [pos, null];
		$(document).on('mousemove.newcrop', function(e) {
			if(!drawing)
				return;
			crop = [crop[0], get_stage_pos(e)];
			render_crop_overlay();
		}).on('mouseup.newcrop', function(e) {
			if(!drawing)
				return;
			let pos = get_stage_pos(e);
			console.log('Mouse Up', pos);
			crop = [crop[0], pos];
			drawing = false;
			$(document).off('.newcrop');
			if(crop[0].x === crop[1].x && crop[0].y === crop[1].y)
				crop = [null, null];
			render_crop_overlay();
			console.log(crop);
		});
	});

	$('.crop_handle').on('mousedown', function(e) {
		let box = crop_bounds(crop);
		if(!box)
			return;
		e.preventDefault();
		e.stopPropagation();
		start_crop_drag({mode: 'resize', handle: this.dataset.handle, box: box});
	});

	$('.crop_box').on('mousedown', function(e) {
		if(e.target.classList.contains('crop_handle'))
			return;
		let box = crop_bounds(crop);
		if(!box)
			return;
		e.preventDefault();
		e.stopPropagation();
		start_crop_drag({mode: 'move', start: get_stage_pos(e), box: box});
	});

	$('.slider_time_pos').on('mousedown', function(e) {
		document.onselectstart = function() {return false};
		let parentrect = e.target.parentElement.getBoundingClientRect();
		function mup(){
			document.onmousemove = null;
			document.onmouseup = null;
			document.onselectstart = function() {return true};
		}
		function mmov(e){
			let percent = (e.clientX-parentrect.x) / (parentrect.width);
			// prevents the time_pos from resetting to 0 after sliding off past 100%
			let total_percent = percent > 1 ? .999999 : percent;
			video.currentTime = video.duration * total_percent
		}
		document.onmousemove = function(e) {mmov(e)};
		document.onmouseup = function() {mup()};
	});
});

$("#run_ffmpeg").click(async () => {
	try{
		const heap_limit = performance.memory.jsHeapSizeLimit;
		if(heap_limit){
			if(selected_file.size * 2.5 > (heap_limit - performance.memory.usedJSHeapSize)){
				if(!confirm("The given file is so large, it is likely to crash your browser!\n\nContinue?")){
					return
				}
			}
		}
	}catch{}

	const cmd = build_ffmpeg_string(true);
	const { createFFmpeg, fetchFile } = FFmpeg;
	const message = document.querySelector(".ffmpeg_log");
	const ffmpeg = createFFmpeg({
		log: true,
		progress: ({ ratio }) => {
			message.innerHTML = `Transcoding Video: ${(ratio * 100.0).toFixed(2)}%`;
			document.title = message.innerHTML;
		},
	});

	try {
		document.querySelector(".download_links").innerHTML = '';
		const {name} = selected_file;
		message.innerHTML = 'Loading ffmpeg-core.js';
		await ffmpeg.load();
		message.innerHTML = 'Start transcoding';
		ffmpeg.FS('writeFile', name, await fetchFile(selected_file));
		await ffmpeg.run(...cmd);// '-i', name,  'output.mp4');
		message.innerHTML = 'Complete transcoding';
		document.title = message.innerHTML;
		const data = ffmpeg.FS('readFile', 'output.mp4');

		let a = document.createElement('a');
		let fn = decodeURI(name);
		a.download = fn;
		let blob = new Blob([data.buffer], {type: 'video/mp4'});
		a.href = window.URL.createObjectURL(blob);
		a.textContent = 'Click here to download [' + fn + "]!";

		document.querySelector(".download_links").append(a);
		a.click();
	} catch (err) {
		console.error(err);
		message.innerHTML = 'Error processing input file. It may be too large for the browser to manage.';
	}
});


function update_slider_fields(range){
	if(!range || range.length < 2)
		return;
	document.querySelectorAll('.slider_control').forEach(function(input) {
		// noinspection JSUndefinedPropertyAssignment
		input.value = range[input.dataset.pos];
	});
	time_start = parseFloat(range[0]);
	time_end = parseFloat(range[1]);
}

function set_slider(){
	let vals = [];
	document.querySelectorAll('.slider_control').forEach(function(input) {
		vals.push(input.value)
	});
	console.log(vals);
	slider.noUiSlider.set(vals);
}


function size_stage_to_video(){
	if(!video_size.w || !video_size.h)
		return;
	let stage = document.getElementById('resizable');
	// Match the stage to the source aspect ratio (and keep it inside the viewport)
	// so the video fills it and no letterboxing is shown.
	let max_w = 900;
	let max_h = Math.max(240, Math.round(window.innerHeight * 0.82));
	let scale = Math.min(max_w / video_size.w, max_h / video_size.h);
	stage.style.width = Math.max(1, Math.round(video_size.w * scale)) + 'px';
	stage.style.height = Math.max(1, Math.round(video_size.h * scale)) + 'px';
}

function fit_video_display(){
	if(!video_size.w || !video_size.h)
		return;
	let container = document.getElementById('resizable');
	let style = getComputedStyle(container);
	let avail_w = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	let avail_h = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	if(avail_w <= 0 || avail_h <= 0)
		return;
	// Fit the video inside the container while preserving the source aspect ratio.
	let scale = Math.min(avail_w / video_size.w, avail_h / video_size.h);
	let disp_w = Math.max(1, Math.floor(video_size.w * scale));
	let disp_h = Math.max(1, Math.floor(video_size.h * scale));
	$('.video_wrapper').css({'width': disp_w, 'height': disp_h});
}

function clamp(v, lo, hi){
	return Math.min(hi, Math.max(lo, v));
}

function get_stage_pos(evt){
	let rect = document.querySelector('.video_wrapper').getBoundingClientRect();
	return {
		x: clamp((evt.clientX - rect.left) / rect.width, 0, 1),
		y: clamp((evt.clientY - rect.top) / rect.height, 0, 1)
	};
}

function crop_bounds(c){
	if(!c || !c[0] || !c[1])
		return null;
	return {
		'x': Math.min(c[0].x, c[1].x),
		'y': Math.min(c[0].y, c[1].y),
		'r': Math.max(c[0].x, c[1].x),
		'b': Math.max(c[0].y, c[1].y)
	};
}

const MIN_CROP = 0.02;
let crop_drag = null;

function start_crop_drag(state){
	crop_drag = state;
	$(document).on('mousemove.cropdrag', on_crop_drag_move)
		.on('mouseup.cropdrag', on_crop_drag_end);
}

function on_crop_drag_move(e){
	if(!crop_drag)
		return;
	let pos = get_stage_pos(e);
	let b = Object.assign({}, crop_drag.box);
	if(crop_drag.mode === 'move'){
		let w = b.r - b.x;
		let h = b.b - b.y;
		b.x = clamp(b.x + (pos.x - crop_drag.start.x), 0, 1 - w);
		b.r = b.x + w;
		b.y = clamp(b.y + (pos.y - crop_drag.start.y), 0, 1 - h);
		b.b = b.y + h;
	}else{
		let hnd = crop_drag.handle;
		if(hnd.indexOf('w') !== -1) b.x = clamp(pos.x, 0, b.r - MIN_CROP);
		if(hnd.indexOf('e') !== -1) b.r = clamp(pos.x, b.x + MIN_CROP, 1);
		if(hnd.indexOf('n') !== -1) b.y = clamp(pos.y, 0, b.b - MIN_CROP);
		if(hnd.indexOf('s') !== -1) b.b = clamp(pos.y, b.y + MIN_CROP, 1);
	}
	crop = [{'x': b.x, 'y': b.y}, {'x': b.r, 'y': b.b}];
	render_crop_overlay();
}

function on_crop_drag_end(){
	crop_drag = null;
	$(document).off('.cropdrag');
}

function set_shade(el, x, y, w, h){
	if(!el)
		return;
	el.style.left = x + 'px';
	el.style.top = y + 'px';
	el.style.width = Math.max(0, w) + 'px';
	el.style.height = Math.max(0, h) + 'px';
}

function render_crop_overlay(){
	let overlay = document.querySelector('.crop_overlay');
	if(!overlay)
		return;
	let b = crop_bounds(crop);
	if(!b || b.r - b.x <= 0 || b.b - b.y <= 0){
		overlay.classList.add('hidden');
		return;
	}
	overlay.classList.remove('hidden');
	let wrapper = document.querySelector('.video_wrapper');
	let W = wrapper.clientWidth;
	let H = wrapper.clientHeight;
	let left = b.x * W;
	let top = b.y * H;
	let width = (b.r - b.x) * W;
	let height = (b.b - b.y) * H;
	let box = overlay.querySelector('.crop_box');
	box.style.left = left + 'px';
	box.style.top = top + 'px';
	box.style.width = width + 'px';
	box.style.height = height + 'px';
	set_shade(overlay.querySelector('.shade_top'), 0, 0, W, top);
	set_shade(overlay.querySelector('.shade_bottom'), 0, top + height, W, H - (top + height));
	set_shade(overlay.querySelector('.shade_left'), 0, top, left, height);
	set_shade(overlay.querySelector('.shade_right'), left + width, top, W - (left + width), height);
}

function unscale(coords, rect){
	return{
		'x': coords.x * rect.width,
		'y': coords.y * rect.height
	}
}

function crop_box(crop, in_width, in_height){
	let rect = {'width': in_width, 'height': in_height};
	let p1 = unscale(crop[0], rect), p2 = unscale(crop[1],rect);
	let x = Math.min(p1.x, p2.x);
	let y = Math.min(p1.y, p2.y);
	let w = Math.abs(p1.x - p2.x);
	let h = Math.abs(p1.y - p2.y);
	return {
		'x': Math.floor(x),
		'y': Math.floor(y),
		'w': Math.floor(w),
		'h': Math.floor(h)
	}
}

function pause_toggle(){
	console.log('toggle play');
	if(video.paused){
		video.play().finally(()=>{$(".play_toggle").html('&#10074;&#10074;')});
	}else{
		video.pause();
		$(".play_toggle").html('&#9654;')
	}
}

async function copyText() {
	await navigator.permissions.query({name: "clipboard-write"});

	await navigator.clipboard.writeText($('.ffmpeg').text()).then(() => {
		console.log('Copied to clipboard.');
	}).catch(console.error)
}

function current_cut_mode(){
	let checked = $('input[name="cut_mode"]:checked');
	return checked.length ? checked.val() : 'accurate';
}

function has_crop(){
	return !!(crop[0] && crop[1]);
}

function build_ffmpeg_string(for_browser_run=false){
	let ts = (time_start?time_start.toFixed(2):0);
	let te = (time_end?time_end.toFixed(2):0);
	// Cropping needs a filter, so it always forces a re-encode.
	let fast_copy = current_cut_mode() === 'fast' && !has_crop();
	let args = [
		'-i', `${for_browser_run ? filename : '"' + filename + '"'}`,
		'-movflags', 'faststart',
		'-t', (te-ts).toFixed(4)
	];
	if (ts) {
		args.unshift('-ss', ts);
	}
	if(has_crop()){
		let box = crop_box(crop, video_size.w, video_size.h);
		let crp = `"crop=${box.w}:${box.h}:${box.x}:${box.y}"`;
		if (for_browser_run) crp = crp.replace(/"/g, '');
		args.push('-filter:v', crp);
	}
	if (fast_copy) {
		args.push('-c:v', 'copy');
	}
	let fn = for_browser_run ? 'output.mp4' : `"edit - ${filename}"`;
	args.push('-c:a', 'copy');
	args.push(fn);
	return for_browser_run ? args : args.join(' ');
}

function update(){
	canvas.width = $(video).width();
	canvas.height = $(video).height();
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	if (video.currentTime < time_start)
		video.currentTime = time_start;
	if (video.currentTime > time_end)
		video.currentTime = time_start;
	let complete_percent = 100 * (video.currentTime / video.duration);
	$(".slider_time_pos").css("left", complete_percent + "%");
	$(".current_time").text(video.currentTime.toFixed(2));
	// noinspection JSCheckFunctionSignatures
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height); //TODO: Subimage using crop.

	render_crop_overlay();

	// Fast mode cannot be combined with a crop (a filter forces a re-encode),
	// so disable it and fall back to accurate while a crop is set.
	let crop_set = has_crop();
	$("#cut_mode_fast").prop('disabled', crop_set);
	if (crop_set && current_cut_mode() === 'fast') {
		$("#cut_mode_accurate").prop('checked', true);
	}
	$(".cut_mode_note").toggleClass('hidden', !crop_set);

	let mpeg = 'ffmpeg ' + build_ffmpeg_string(false);
	if($('.ffmpeg').text() !== mpeg) {
		$('.ffmpeg').text(mpeg);
	}
	requestAnimationFrame(update.bind(this)); // Tell browser to trigger this method again, next animation frame.
}

update(); //Start rendering

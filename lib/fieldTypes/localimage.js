/*!
 * Module dependencies.
 */

var fs = require('fs-extra'),
	path = require('path'),
	_ = require('underscore'),
	moment = require('moment'),
	async = require('async'),
	util = require('util'),
	utils = require('keystone-utils'),
	super_ = require('../field'),
	easyimg = require('easyimage');

/**
 * localimage FieldType Constructor
 * @extends Field
 * @api public
 */

function localimage(list, path, options) {

	this._underscoreMethods = ['format', 'uploadImage'];

	// event queues
	this._pre = {
		move: [] // Before file is moved into final destination
	};

	this._post = {
		move: [] // After file is moved into final destination
	};

	// TODO: implement filtering, usage disabled for now
	options.nofilter = true;

	// TODO: implement initial form, usage disabled for now
	if (options.initial) {
		throw new Error('Invalid Configuration\n\n' +
			'localimage fields (' + list.key + '.' + path + ') do not currently support being used as initial fields.\n');
	}

	if (options.overwrite !== false) {
		options.overwrite = true;
	}

	localimage.super_.call(this, list, path, options);

	// validate destination dir
	if (!options.dest) {
		throw new Error('Invalid Configuration\n\n' +
			'localimage fields (' + list.key + '.' + path + ') require the "dest" option to be set.');
	}

	// Allow hook into before and after
	if (options.pre && options.pre.move) {
		this._pre.move = this._pre.move.concat(options.pre.move);
	}

	if (options.post && options.post.move) {
		this._post.move = this._post.move.concat(options.post.move);
	}
}

/*!
 * Inherit from Field
 */

util.inherits(localimage, super_);


/**
 * Allows you to add pre middleware after the field has been initialised
 *
 * @api public
 */

localimage.prototype.pre = function(event, fn) {
	if (!this._pre[event]) {
		throw new Error('localimage (' + this.list.key + '.' + this.path + ') error: localimage.pre()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._pre[event].push(fn);
	return this;
};


/**
 * Allows you to add post middleware after the field has been initialised
 *
 * @api public
 */

localimage.prototype.post = function(event, fn) {
	if (!this._post[event]) {
		throw new Error('localimage (' + this.list.key + '.' + this.path + ') error: localimage.post()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._post[event].push(fn);
	return this;
};


/**
 * Registers the field on the List's Mongoose Schema.
 *
 * @api public
 */

localimage.prototype.addToSchema = function() {

	var field = this,
		schema = this.list.schema;

	var paths = this.paths = {
		// fields
		filename:		this._path.append('.filename'),
		path:			this._path.append('.path'),
		size:			this._path.append('.size'),
		filetype:		this._path.append('.filetype'),
		data: 			this._path.append('.data'),
		// virtuals
		exists:			this._path.append('.exists'),
		href:			this._path.append('.href'),
		data:           this._path.append('_data'),
		upload:			this._path.append('_upload'),
		action:			this._path.append('_action')
	};

	var schemaPaths = this._path.addTo({}, {
		filename:		String,
		path:			String,
		size:			Number,
		filetype:		String,
		data:			String
	});

	schema.add(schemaPaths);

	// exists checks for a matching file at run-time
	var exists = function(item) {
		var filepath = item.get(paths.path),
			filename = item.get(paths.filename);

		if (!filepath || !filename) {
			return false;
		}

		return fs.existsSync(path.join(filepath, filename));
	};

	// The .exists virtual indicates whether a file is stored
	schema.virtual(paths.exists).get(function() {
		return schemaMethods.exists.apply(this);
	});

	// The .href virtual returns the public path of the file
	schema.virtual(paths.href).get(function() {
		return field.href.call(field, this);
	});

	// reset clears the value of the field
	var reset = function(item) {
		item.set(field.path, {
			filename: '',
			path: '',
			size: 0,
			filetype: ''
		});
	};

	var schemaMethods = {
		exists: function() {
			return exists(this);
		},
		/**
		 * Resets the value of the field
		 *
		 * @api public
		 */
		reset: function() {
			reset(this);
		},
		/**
		 * Deletes the file from localimage and resets the field
		 *
		 * @api public
		 */
		delete: function() {
			if (exists(this)) {
				fs.unlinkSync(path.join(this.get(paths.path), this.get(paths.filename)));
			}
			reset(this);
		}
	};

	_.each(schemaMethods, function(fn, key) {
		field.underscoreMethod(key, fn);
	});

	// expose a method on the field to call schema methods
	this.apply = function(item, method) {
		return schemaMethods[method].apply(item, Array.prototype.slice.call(arguments, 2));
	};

	this.bindUnderscoreMethods();
};


/**
 * Formats the field value
 *
 * Delegates to the options.format function if it exists.
 * @api public
 */

localimage.prototype.format = function(item) {
	if (!item.get(this.paths.filename)) return '';
	if (this.hasFormatter()) {
		var file = item.get(this.path);
		file.href = this.href(item);
		return this.options.format.call(this, item, file);
	}
	return this.href(item);
};


/**
 * Detects whether the field has formatter function
 *
 * @api public
 */

localimage.prototype.hasFormatter = function() {
	return 'function' === typeof this.options.format;
};


/**
 * Return the public href for the stored file
 *
 * @api public
 */

localimage.prototype.href = function(item) {
	if (!item.get(this.paths.filename)) return '';
	var prefix = this.options.prefix ? this.options.prefix : item.get(this.paths.path);
	return path.join(prefix, item.get(this.paths.filename));
};


/**
 * Detects whether the field has been modified
 *
 * @api public
 */

localimage.prototype.isModified = function(item) {
	return item.isModified(this.paths.path);
};


/**
 * Validates that a value for this field has been provided in a data object
 *
 * @api public
 */

localimage.prototype.validateInput = function(data) {
	// TODO - how should file field input be validated?
	return true;
};


/**
 * Updates the value for this field in the item from a data object
 *
 * @api public
 */

localimage.prototype.updateItem = function(item, data) {
	// TODO - direct updating of data (not via upload)
};


/**
 * Uploads the file for this field
 *
 * @api public
 */

localimage.prototype.uploadImage = function(item, file, data, update, callback) {

	var field = this,
		prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
		name = prefix + file.name;
	if (field.options.allowedTypes && !_.contains(field.options.allowedTypes, file.type)){
		return callback(new Error('Unsupported File Type: '+file.type));
	}

	if ('function' === typeof update) {
		callback = update;
		update = false;
	}

	var doSave = function(callback) {
		console.log('Saving')
		if ('function' === typeof field.options.filename) {
			name = field.options.filename(item, name);
		}



		var img = JSON.parse(data);
		var nameJPG = name.substr(0, name.lastIndexOf('.'))+".jpg";

		var imgData = {
				filename: nameJPG,
				src: file.path,
				path: field.options.dest,
				size: file.size,
				filetype: file.type,
				width: img.width,
				height: img.height,
				x: img.x,
				y: img.y
			};
		
		var resize = field.options.pre
		console.log('Cropping');
		easyimg.crop({
			src: file.path, dst:path.join(field.options.dest, nameJPG),
			cropwidth: img.width, cropheight: img.height,
			quality: 80, gravity: "NorthWest",
			x: img.x, y: img.y
		}).then(
			function(image) {
				console.log('Resizing');
				easyimg.resize({
					src: path.join(field.options.dest, nameJPG), dst:path.join(field.options.dest, nameJPG),
					width: resize.width, height: resize.height,
					quality: 80, gravity: "NorthWest"
				}).then(
					function(image) {
						console.log('Resized and cropped: ' + image.width + ' x ' + image.height);
						if (update) {
							item.set(field.path, imgData);
						}
						callback(null, imgData);
		  		},
					function (err) {
						console.log(err);
						callback(err);
					});
				},
			function (err) {
				console.log(err);
				callback(err);
			}
		);
	};

	async.eachSeries(this._pre.move, function(fn, next) {
		fn(item, file, next);
	}, function(err) {

		if (err) return callback(err);

		doSave(function(err, imgData) {
			if (err) return callback(err);

			async.eachSeries(field._post.move, function(fn, next) {
				fn(item, file, imgData, next);
			}, function(err) {
				if (err) return callback(err);
				callback(null, imgData);
			});
		});

	});
};


/**
 * Returns a callback that handles a standard form submission for the field
 *
 * Expected form parts are
 * - `field.paths.action` in `req.body` (`clear` or `delete`)
 * - `field.paths.upload` in `req.files` (uploads the file to localimage)
 *
 * @api public
 */

localimage.prototype.getRequestHandler = function(item, req, paths, callback) {
	var field = this;

	if (utils.isFunction(paths)) {
		callback = paths;
		paths = field.paths;
	} else if (!paths) {
		paths = field.paths;
	}

	callback = callback || function() {};

	return function() {

		if (req.body) {

			var action = req.body[paths.action];
			var $data = req.body[paths.data];



			if (/^(delete|reset)$/.test(action)) {
				field.apply(item, action);
			}
		}

		if (req.files && req.files[paths.upload] && req.files[paths.upload].size && req.body[paths.data]) {

			return field.uploadImage(item, req.files[paths.upload],$data, true, callback);
		}

		return callback();

	};

};


/**
 * Immediately handles a standard form submission for the field (see `getRequestHandler()`)
 *
 * @api public
 */

localimage.prototype.handleRequest = function(item, req, paths, callback) {
	this.getRequestHandler(item, req, paths, callback)();
};


/*!
 * Export class
 */

exports = module.exports = localimage;

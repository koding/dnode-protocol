BIN=./node_modules/.bin

bundle:
	@$(BIN)/browserify -g coffeeify --extension=".coffee" \
		index.coffee > bundle.js
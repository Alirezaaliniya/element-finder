<?php

namespace ElementorPro\Modules\Interactions;

use ElementorPro\Plugin;
use ElementorPro\Core\Utils as ProUtils;
use Elementor\Utils;
use Elementor\Modules\Interactions\Module as InteractionsModule;
use Elementor\Modules\Interactions\Presets;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Hooks {
	const PACKAGES = [
		'editor-interactions-extended',
	];

	public function register() {
		$this->register_packages()
			->register_pro_scripts()
			->replace_core_handlers();

		return $this;
	}

	private function register_packages() {
		add_filter( 'elementor-pro/editor/v2/packages', function ( $packages ) {
			return array_merge( $packages, self::PACKAGES );
		} );

		return $this;
	}

	private function register_pro_scripts() {
		add_action( 'elementor/frontend/after_register_scripts', [ $this, 'register_frontend_scripts' ], 20 );
		add_action( 'elementor/preview/enqueue_scripts', [ $this, 'register_editor_scripts' ], 1 );

		return $this;
	}

	private function replace_core_handlers() {
		// Run after core's print_interactions_data (priority 1). If core enqueued its script
		// it means the page has interactions — swap it for the pro script. If core didn't
		// enqueue anything (no interactions), we skip too, preserving the load optimization.
		add_action( 'wp_footer', [ $this, 'replace_frontend_handlers' ], 2 );

		add_action( 'elementor/preview/enqueue_scripts', function() {
			$core_module = Plugin::elementor()->modules_manager->get_modules( ProUtils::get_class_constant( InteractionsModule::class, 'MODULE_NAME', 'e-interactions' ) );
			if ( $core_module && method_exists( $core_module, 'enqueue_preview_scripts' ) ) {
				remove_action( 'elementor/preview/enqueue_scripts', [ $core_module, 'enqueue_preview_scripts' ] );
			}
		}, 1 );

		add_action( 'elementor/preview/enqueue_scripts', [ $this, 'replace_preview_handlers' ], 20 );

		return $this;
	}

	public function register_frontend_scripts() {
		wp_register_script(
			'elementor-interactions-pro',
			$this->get_js_assets_url( 'interactions-pro' ),
			[
				ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_MOTION_JS', 'motion-js' ),
				ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_SHARED_UTILS', 'elementor-interactions-shared-utils' ),
			],
			ELEMENTOR_PRO_VERSION,
			true
		);
	}

	public function register_editor_scripts() {
		wp_register_script(
			'elementor-editor-interactions-pro',
			$this->get_js_assets_url( 'editor-interactions-pro' ),
			[
				ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_MOTION_JS', 'motion-js' ),
				ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_SHARED_UTILS', 'elementor-interactions-shared-utils' ),
			],
			ELEMENTOR_PRO_VERSION,
			true
		);
	}

	public function replace_frontend_handlers() {
		$handle_frontend = ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_FRONTEND', 'elementor-interactions' );

		// Core only enqueues its script when the page has interactions.
		// If it didn't enqueue, there's nothing to replace — skip to preserve the load optimization.
		if ( ! wp_script_is( $handle_frontend, 'enqueued' ) ) {
			return;
		}

		wp_dequeue_script( $handle_frontend );
		wp_deregister_script( $handle_frontend );

		wp_enqueue_script( 'elementor-interactions-pro' );

		wp_localize_script(
			'elementor-interactions-pro',
			ProUtils::get_class_constant( InteractionsModule::class, 'JS_CONFIG_OBJECT', 'ElementorInteractionsConfig' ),
			$this->get_config()
		);
	}

	public function replace_preview_handlers() {
		$handle_editor = ProUtils::get_class_constant( InteractionsModule::class, 'HANDLE_EDITOR', 'elementor-editor-interactions' );
		wp_dequeue_script( $handle_editor );
		wp_deregister_script( $handle_editor );

		wp_enqueue_script( 'elementor-editor-interactions-pro' );

		wp_localize_script(
			'elementor-editor-interactions-pro',
			ProUtils::get_class_constant( InteractionsModule::class, 'JS_CONFIG_OBJECT', 'ElementorInteractionsConfig' ),
			$this->get_config()
		);
	}

	private function get_config() {
		if ( class_exists( 'Elementor\\Modules\\Interactions\\Module' ) ) {
			$module = \Elementor\Modules\Interactions\Module::instance();
			if ( $module && is_callable( [ $module, 'get_config' ] ) ) {
				return $module->get_config();
			}
		}

		return [
			'constants'  => class_exists( Presets::class ) ? ( new Presets() )->defaults() : [],
			'breakpoints' => [],
		];
	}

	private function get_js_assets_url( $filename ) {
		$suffix = ( Utils::is_script_debug() || Utils::is_elementor_tests() ) ? '' : '.min';
		return ELEMENTOR_PRO_URL . 'assets/js/' . $filename . $suffix . '.js';
	}
}

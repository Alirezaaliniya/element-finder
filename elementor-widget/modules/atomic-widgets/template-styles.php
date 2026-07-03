<?php

namespace ElementorPro\Modules\AtomicWidgets;

use Elementor\Core\Base\Document;
use Elementor\Modules\AtomicWidgets\Styles\CacheValidity\Cache_Validity;
use Elementor\Modules\AtomicWidgets\Utils\Utils;
use Throwable;
use ElementorPro\Plugin;

class Template_Styles {
	const CACHE_ROOT_KEY = 'template-styles-related-posts';
	private $logger;

	public function __construct() {
		$this->logger = Plugin::elementor()->logger->get_logger();
	}

	public function register_hooks() {
		add_action( 'elementor/post/render', fn( $post_id ) => $this->render_post( $post_id ) );

		add_action( 'elementor/document/after_save', fn( Document $document ) => $this->invalidate_cache(
			[ $document->get_main_post()->ID ]
		), 20, 2 );

		add_action(
			'elementor/core/files/clear_cache',
			fn() => $this->invalidate_cache(),
		);
	}

	private function render_post( $post_id ): void {
		try {
			$cache_validity = new Cache_Validity();

			if ( $cache_validity->is_valid( [ self::CACHE_ROOT_KEY, $post_id ] ) ) {
				$template_ids = $cache_validity->get_meta( [ self::CACHE_ROOT_KEY, $post_id ] );

				if ( empty( $template_ids ) || ! is_array( $template_ids ) ) {
					return;
				}

				$this->declare_templates_rendered( $template_ids );
				return;
			}

			$template_ids = $this->get_template_ids_from_post( $post_id );

			$cache_validity->validate( [ self::CACHE_ROOT_KEY, $post_id ], $template_ids );

			$this->declare_templates_rendered( $template_ids );
		} catch ( Throwable $e ) {
			$this->logger->error( 'Error associating template ids with post: ' . $e->getMessage() );
		}
	}

	private function declare_templates_rendered( array $post_ids ): void {
		foreach ( $post_ids as $post_id ) {
			if ( ! is_numeric( $post_id ) || (int) $post_id <= 0 ) {
				continue;
			}

			do_action( 'elementor/post/render', $post_id );
		}
	}

	private function get_template_ids_from_post( $post_id ): array {
		$template_ids = [];

		Utils::traverse_post_elements( $post_id, function( $element_data ) use ( &$template_ids ) {
			if ( empty( $element_data['settings']['template_id'] ) ) {
				return;
			}

			$template_id = $element_data['settings']['template_id'];

			if ( is_numeric( $template_id ) && $template_id > 0 ) {
				$template_ids[] = (int) $template_id;
			}
		} );

		return array_unique( $template_ids );
	}

	private function invalidate_cache( ?array $post_ids = null ): void {
		$cache_validity = new Cache_Validity();

		if ( empty( $post_ids ) ) {
			$cache_validity->invalidate( [ self::CACHE_ROOT_KEY ] );

			return;
		}

		foreach ( $post_ids as $post_id ) {
			$cache_validity->invalidate( [ self::CACHE_ROOT_KEY, $post_id ] );
		}
	}
}
